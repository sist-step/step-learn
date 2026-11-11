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
 * 復元で作る内容。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/stepbundle/lib.php');

/**
 * 活動 1 つを復元する。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class restore_stepbundle_activity_structure_step extends restore_activity_structure_step {
    /**
     * @return restore_path_element[]
     */
    protected function define_structure() {
        return $this->prepare_activity_structure([new restore_path_element('stepbundle', '/activity/stepbundle')]);
    }

    /**
     * @param array $data
     */
    protected function process_stepbundle($data) {
        global $DB;
        $data = (object) $data;
        $data->course = $this->get_courseid();
        // 元の活動が残っているのは、複製やコースのコピー。同じ鍵のままにしないのは、STEP Learn で 2 つの活動が同じファイルを指し、
        // 片方の編集がもう片方にも及ぶため。ごみ箱から戻すときは元の活動がもうないので、鍵を保って前のファイルに結び付け直す
        if (empty($data->bundlekey) || $DB->record_exists('stepbundle', ['bundlekey' => $data->bundlekey])) {
            $data->bundlekey = stepbundle_new_key();
        }
        $this->apply_activity_instance($DB->insert_record('stepbundle', $data));
    }

    /**
     * @return void
     */
    protected function after_execute() {
        $this->add_related_files('mod_stepbundle', 'intro', null);
    }
}
