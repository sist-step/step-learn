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
 * 活動のバックアップ。ごみ箱から戻したときに、同じ鍵で STEP Learn の配布するファイルと結び付け直すために要る。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/stepbundle/backup/moodle2/backup_stepbundle_stepslib.php');

/**
 * 活動 1 つをバックアップする手順。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class backup_stepbundle_activity_task extends backup_activity_task {
    /**
     * @return void
     */
    protected function define_my_settings() {
    }

    /**
     * @return void
     */
    protected function define_my_steps() {
        $this->add_step(new backup_stepbundle_activity_structure_step('stepbundle_structure', 'stepbundle.xml'));
    }

    /**
     * @param string $content
     * @return string
     */
    public static function encode_content_links($content) {
        global $CFG;
        $base = preg_quote($CFG->wwwroot, '/');
        $content = preg_replace('/(' . $base . '\/mod\/stepbundle\/index.php\?id\=)([0-9]+)/', '$@STEPBUNDLEINDEX*$2@$', $content);
        return preg_replace('/(' . $base . '\/mod\/stepbundle\/view.php\?id\=)([0-9]+)/', '$@STEPBUNDLEVIEWBYID*$2@$', $content);
    }
}
