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
 * 活動を開いたとき。ファイルの一覧や「VS Code で開く」は STEP Learn にあるので、STEP Learn のアイテムの画面に移す。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require('../../config.php');
require_once($CFG->dirroot . '/mod/stepbundle/lib.php');

$id = required_param('id', PARAM_INT);
[$course, $cm] = get_course_and_cm_from_cmid($id, 'stepbundle');
require_course_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/stepbundle:view', $context);
$bundle = $DB->get_record('stepbundle', ['id' => $cm->instance], '*', MUST_EXIST);

stepbundle_view($bundle, $course, $cm, $context);

$appurl = rtrim((string) get_config('local_steplearn', 'appurl'), '/');
if ($appurl !== '') {
    // STEP Learn の Moodle モードでは、コースとアイテムの ID が Moodle のコースと活動（cmid）の ID と同じ
    redirect($appurl . '/courses/' . $course->id . '/items/' . $cm->id);
}

$PAGE->set_url('/mod/stepbundle/view.php', ['id' => $cm->id]);
$PAGE->set_title($course->shortname . \moodle_page::TITLE_SEPARATOR . format_string($bundle->name));
$PAGE->set_heading($course->fullname);
$PAGE->set_activity_record($bundle);

echo $OUTPUT->header();
echo $OUTPUT->notification(get_string('notconfigured', 'local_steplearn'), \core\output\notification::NOTIFY_WARNING);
echo $OUTPUT->footer();
