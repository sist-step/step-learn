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
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use local_steplearn\migration;

/**
 * コースでロールを割り当てられた人と、そのロールの元の種類（archetype）・受講の状態。STEP Learn の移行ツールが参加者を作るのに使う。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class get_participants extends external_api {
    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'course id'),
        ]);
    }

    /**
     * @param int $courseid
     * @return array
     */
    public static function execute(int $courseid): array {
        global $DB;
        ['courseid' => $courseid] = self::validate_parameters(self::execute_parameters(), ['courseid' => $courseid]);
        self::validate_context(\context_system::instance());
        $course = migration::require_course($courseid);
        $context = \context_course::instance($course->id);

        // コースのコンテキストのロールだけを見るのは、カテゴリやサイトで割り当てたマネージャーまで参加者にしないため
        $roles = [];
        foreach ($DB->get_records('role_assignments', ['contextid' => $context->id], 'id', 'id, userid, roleid') as $ra) {
            $roles[$ra->userid][] = $ra->roleid;
        }
        if (!$roles) {
            return [];
        }
        // 元の種類のないロールを名前で見るのは、独自に作った「editingteacher」などの名前のロールも教師・学生として扱うため
        $archetypes = array_map(
            fn($role) => $role->archetype ?: $role->shortname,
            $DB->get_records('role', null, '', 'id, shortname, archetype')
        );
        $active = get_enrolled_users($context, '', 0, 'u.id', null, 0, 0, true);
        [$insql, $params] = $DB->get_in_or_equal(array_keys($roles));
        $users = $DB->get_records_select('user', "id $insql", $params, 'id', 'id, username, email, firstname, lastname, suspended, deleted');

        $result = [];
        foreach ($users as $user) {
            $result[] = [
                'id' => (int) $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'firstname' => $user->firstname,
                'lastname' => $user->lastname,
                'suspended' => (bool) $user->suspended,
                'deleted' => (bool) $user->deleted,
                'active' => isset($active[$user->id]),
                'archetypes' => array_values(array_unique(array_filter(
                    array_map(fn($roleid) => $archetypes[$roleid] ?? '', $roles[$user->id])
                ))),
            ];
        }
        return $result;
    }

    /**
     * @return external_multiple_structure
     */
    public static function execute_returns(): external_multiple_structure {
        return new external_multiple_structure(new external_single_structure([
            'id' => new external_value(PARAM_INT, 'user id'),
            'username' => new external_value(PARAM_RAW, 'username'),
            'email' => new external_value(PARAM_RAW, 'email'),
            'firstname' => new external_value(PARAM_RAW, 'first name'),
            'lastname' => new external_value(PARAM_RAW, 'last name'),
            'suspended' => new external_value(PARAM_BOOL, 'the account is suspended'),
            'deleted' => new external_value(PARAM_BOOL, 'the account is deleted'),
            'active' => new external_value(PARAM_BOOL, 'has an active enrolment in the course'),
            'archetypes' => new external_multiple_structure(new external_value(PARAM_ALPHANUMEXT, 'role archetype')),
        ]));
    }
}
