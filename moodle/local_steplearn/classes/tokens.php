<?php
// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.

namespace local_steplearn;

use core_external\util;

/**
 * STEP Learn が利用者の代わりに使う Web サービスのトークン。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class tokens {
    /** @var int 期限までの残りがこれより短いトークンは使い回さずに作り直す */
    const MIN_REMAINING = DAYSECS;

    /**
     * ユーザーの STEP Learn 用トークンを使い回すか、なければ作る。
     *
     * @param int $userid
     * @return array{token: string, validuntil: int}
     */
    public static function for_user(int $userid): array {
        global $CFG, $DB;
        $service = $DB->get_record('external_services', ['shortname' => app::SERVICE, 'enabled' => 1], '*', MUST_EXIST);
        $existing = $DB->get_records_select(
            'external_tokens',
            'userid = ? AND externalserviceid = ? AND tokentype = ? AND (validuntil = 0 OR validuntil > ?)',
            [$userid, $service->id, EXTERNAL_TOKEN_PERMANENT, time() + self::MIN_REMAINING],
            'timecreated DESC',
            'id, token, validuntil',
            0,
            1
        );
        if ($existing) {
            $token = reset($existing);
            return ['token' => $token->token, 'validuntil' => (int) $token->validuntil];
        }
        $validuntil = empty($CFG->tokenduration) ? 0 : time() + (int) $CFG->tokenduration;
        // util::generate_token_for_current_user を使わないのは、カスタムサービスのトークンをサイト管理者には発行できず、
        // ほかのユーザーにも moodle/webservice:createtoken の権限を付ける必要があるため
        $token = util::generate_token(
            EXTERNAL_TOKEN_PERMANENT,
            $service,
            $userid,
            \context_system::instance(),
            $validuntil,
            (string) get_config('local_steplearn', 'tokeniprestriction'),
            'STEP Learn'
        );
        return ['token' => $token, 'validuntil' => $validuntil];
    }
}
