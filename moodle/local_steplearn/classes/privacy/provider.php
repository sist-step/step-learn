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

namespace local_steplearn\privacy;

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\userlist;

/**
 * 個人情報 API。保存するのは 60 秒で消える使い捨てのコードだけなので、書き出す内容はない。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class provider implements
    \core_privacy\local\metadata\provider,
    \core_privacy\local\request\core_userlist_provider,
    \core_privacy\local\request\plugin\provider {
    /**
     * @param collection $collection
     * @return collection
     */
    public static function get_metadata(collection $collection): collection {
        $collection->add_database_table('local_steplearn_codes', [
            'userid' => 'privacy:metadata:codes:userid',
            'timecreated' => 'privacy:metadata:codes:timecreated',
        ], 'privacy:metadata:codes');
        $collection->add_external_location_link('steplearn', [
            'userid' => 'privacy:metadata:steplearn:userid',
            'username' => 'privacy:metadata:steplearn:username',
            'fullname' => 'privacy:metadata:steplearn:fullname',
            'email' => 'privacy:metadata:steplearn:email',
        ], 'privacy:metadata:steplearn');
        return $collection;
    }

    /**
     * @param int $userid
     * @return contextlist
     */
    public static function get_contexts_for_userid(int $userid): contextlist {
        $contextlist = new contextlist();
        $contextlist->add_from_sql(
            'SELECT ctx.id FROM {context} ctx WHERE ctx.contextlevel = :level AND EXISTS (
                SELECT 1 FROM {local_steplearn_codes} c WHERE c.userid = :userid)',
            ['level' => CONTEXT_SYSTEM, 'userid' => $userid]
        );
        return $contextlist;
    }

    /**
     * @param userlist $userlist
     */
    public static function get_users_in_context(userlist $userlist) {
        if ($userlist->get_context()->contextlevel == CONTEXT_SYSTEM) {
            $userlist->add_from_sql('userid', 'SELECT userid FROM {local_steplearn_codes}', []);
        }
    }

    /**
     * @param approved_contextlist $contextlist
     */
    public static function export_user_data(approved_contextlist $contextlist) {
    }

    /**
     * @param \context $context
     */
    public static function delete_data_for_all_users_in_context(\context $context) {
        global $DB;
        if ($context->contextlevel == CONTEXT_SYSTEM) {
            $DB->delete_records('local_steplearn_codes');
        }
    }

    /**
     * @param approved_contextlist $contextlist
     */
    public static function delete_data_for_user(approved_contextlist $contextlist) {
        global $DB;
        $DB->delete_records('local_steplearn_codes', ['userid' => $contextlist->get_user()->id]);
    }

    /**
     * @param approved_userlist $userlist
     */
    public static function delete_data_for_users(approved_userlist $userlist) {
        global $DB;
        if ($userlist->get_context()->contextlevel != CONTEXT_SYSTEM || !$userlist->get_userids()) {
            return;
        }
        [$sql, $params] = $DB->get_in_or_equal($userlist->get_userids());
        $DB->delete_records_select('local_steplearn_codes', "userid $sql", $params);
    }
}
