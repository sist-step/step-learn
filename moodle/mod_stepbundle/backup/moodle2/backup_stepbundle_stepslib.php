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
 * バックアップに書き出す内容。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * 活動の名前・説明・鍵を書き出す。配布するファイルは STEP Learn にあるので含まれない。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class backup_stepbundle_activity_structure_step extends backup_activity_structure_step {
    /**
     * @return backup_nested_element
     */
    protected function define_structure() {
        $bundle = new backup_nested_element('stepbundle', ['id'], ['name', 'intro', 'introformat', 'bundlekey', 'timemodified']);
        $bundle->set_source_table('stepbundle', ['id' => backup::VAR_ACTIVITYID]);
        $bundle->annotate_files('mod_stepbundle', 'intro', null);
        return $this->prepare_activity_structure($bundle);
    }
}
