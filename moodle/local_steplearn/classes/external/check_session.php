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

namespace local_steplearn\external;

use core\session\manager;
use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_single_structure;
use core_external\external_value;

/**
 * STEP Learn のセッションを始めた Moodle のセッションが続いているかを返し、続いていれば最終アクセスを今にする。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class check_session extends external_api {
    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'sidhash' => new external_value(PARAM_ALPHANUM, 'SHA-256 of the Moodle session id'),
        ]);
    }

    /**
     * @param string $sidhash
     * @return array{active: bool}
     */
    public static function execute(string $sidhash): array {
        global $USER;
        $params = self::validate_parameters(self::execute_parameters(), ['sidhash' => $sidhash]);
        self::validate_context(\context_system::instance());

        // セッション ID そのものを受け取らないのは、STEP Learn にはハッシュしか渡していない（漏れても Moodle のセッションを乗っ取れない）ため
        foreach (manager::get_sessions_by_userid((int) $USER->id) as $record) {
            if (empty($record->sid) || !hash_equals(hash('sha256', $record->sid), $params['sidhash'])) {
                continue;
            }
            if (!manager::session_exists($record->sid)) {
                return ['active' => false];
            }
            // 確かめるだけにしないのは、STEP Learn だけを使っている間に Moodle のセッションが時間切れになり、使っている最中にログアウトさせてしまうため
            manager::touch_session($record->sid);
            return ['active' => true];
        }
        return ['active' => false];
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'active' => new external_value(PARAM_BOOL, 'whether the Moodle session is still active'),
        ]);
    }
}
