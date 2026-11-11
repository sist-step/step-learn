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

/**
 * 活動の復元。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/stepbundle/backup/moodle2/restore_stepbundle_stepslib.php');

/**
 * 活動 1 つを復元する手順。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class restore_stepbundle_activity_task extends restore_activity_task {
    /**
     * @return void
     */
    protected function define_my_settings() {
    }

    /**
     * @return void
     */
    protected function define_my_steps() {
        $this->add_step(new restore_stepbundle_activity_structure_step('stepbundle_structure', 'stepbundle.xml'));
    }

    /**
     * @return restore_decode_content[]
     */
    public static function define_decode_contents() {
        return [new restore_decode_content('stepbundle', ['intro'], 'stepbundle')];
    }

    /**
     * @return restore_decode_rule[]
     */
    public static function define_decode_rules() {
        return [
            new restore_decode_rule('STEPBUNDLEVIEWBYID', '/mod/stepbundle/view.php?id=$1', 'course_module'),
            new restore_decode_rule('STEPBUNDLEINDEX', '/mod/stepbundle/index.php?id=$1', 'course'),
        ];
    }

    /**
     * @return restore_log_rule[]
     */
    public static function define_restore_log_rules() {
        return [];
    }

    /**
     * @return restore_log_rule[]
     */
    public static function define_restore_log_rules_for_course() {
        return [];
    }
}
