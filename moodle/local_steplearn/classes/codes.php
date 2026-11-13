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

/**
 * ログインを STEP Learn に引き継ぐ使い捨てのコード。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class codes {
    /** @var int コードの有効期限（秒） */
    const TTL = 60;

    /** @var string */
    const TABLE = 'local_steplearn_codes';

    /**
     * ログインしたユーザーにコードを発行する。
     *
     * @param int $userid
     * @param string $challenge PKCE S256 code challenge
     * @param string $sid Moodle session id
     * @return string コード（DB にはハッシュだけを保存する）
     */
    public static function create(int $userid, string $challenge, string $sid): string {
        global $DB;
        // 「Log in as」のセッションにも発行しないのは、交換したトークンには本当のユーザーも「Log in as」を許したコースも残らず、
        // なりすました相手としてすべてのコースを操作できてしまうため
        if (\core\session\manager::is_loggedinas()) {
            throw new \moodle_exception('nologinas');
        }
        $DB->delete_records_select(self::TABLE, 'timecreated < ?', [time() - self::TTL]);
        $code = self::base64url(random_bytes(32));
        $DB->insert_record(self::TABLE, (object) [
            'codehash' => hash('sha256', $code),
            'userid' => $userid,
            'challenge' => $challenge,
            'sidhash' => hash('sha256', $sid),
            'timecreated' => time(),
        ]);
        return $code;
    }

    /**
     * コードを使い切る。有効で verifier も一致すれば、保存していた行を返す。
     *
     * @param string $code
     * @param string $verifier PKCE code verifier
     * @return \stdClass|null
     */
    public static function consume(string $code, string $verifier): ?\stdClass {
        global $DB;
        $record = $DB->get_record(self::TABLE, ['codehash' => hash('sha256', $code)]);
        if (!$record) {
            return null;
        }
        // 照合に失敗したときも消すのは、同じコードに対して verifier を何度も試させないため
        $DB->delete_records(self::TABLE, ['id' => $record->id]);
        if ($record->timecreated < time() - self::TTL) {
            return null;
        }
        if (!hash_equals($record->challenge, self::base64url(hash('sha256', $verifier, true)))) {
            return null;
        }
        return $record;
    }

    /**
     * @param string $bytes
     * @return string
     */
    private static function base64url(string $bytes): string {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
