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

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_single_structure;
use core_external\external_value;
use local_steplearn\codes;
use local_steplearn\tokens;

/**
 * ログイン後に渡したコードを、そのユーザーの STEP Learn 用トークンに交換する。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class exchange_code extends external_api {
    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'code' => new external_value(PARAM_ALPHANUMEXT, 'one-time code'),
            'verifier' => new external_value(PARAM_ALPHANUMEXT, 'PKCE code verifier'),
        ]);
    }

    /**
     * @param string $code
     * @param string $verifier
     * @return array
     */
    public static function execute(string $code, string $verifier): array {
        ['code' => $code, 'verifier' => $verifier] = self::validate_parameters(
            self::execute_parameters(),
            ['code' => $code, 'verifier' => $verifier]
        );
        $context = \context_system::instance();
        self::validate_context($context);
        require_capability('local/steplearn:exchangecode', $context);

        $record = codes::consume($code, $verifier);
        $user = $record ? \core_user::get_user($record->userid) : null;
        if (!$user || $user->deleted || $user->suspended || isguestuser($user)) {
            throw new \moodle_exception('invalidcode', 'local_steplearn');
        }
        $token = tokens::for_user($user->id);
        return [
            'token' => $token['token'],
            'validuntil' => $token['validuntil'],
            'sidhash' => $record->sidhash,
            'userid' => (int) $user->id,
            'username' => $user->username,
            'fullname' => fullname($user),
            'email' => $user->email,
            'siteadmin' => is_siteadmin($user),
        ];
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'token' => new external_value(PARAM_ALPHANUM, 'web service token'),
            'validuntil' => new external_value(PARAM_INT, 'token expiry (0 = never)'),
            'sidhash' => new external_value(PARAM_ALPHANUM, 'SHA-256 of the Moodle session id'),
            'userid' => new external_value(PARAM_INT, 'user id'),
            'username' => new external_value(PARAM_RAW, 'username'),
            'fullname' => new external_value(PARAM_TEXT, 'full name'),
            'email' => new external_value(PARAM_RAW, 'email'),
            'siteadmin' => new external_value(PARAM_BOOL, 'site administrator'),
        ]);
    }
}
