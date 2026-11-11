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
 * 活動モジュールとして Moodle から呼ばれる関数。
 *
 * 配布するファイルは Moodle に置かず、STEP Learn が bundlekey で見分けて持つ。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * @param string $feature FEATURE_xx
 * @return mixed
 */
function stepbundle_supports($feature) {
    return match ($feature) {
        FEATURE_MOD_ARCHETYPE => MOD_ARCHETYPE_RESOURCE,
        FEATURE_GROUPS => false,
        FEATURE_GROUPINGS => false,
        FEATURE_MOD_INTRO => true,
        FEATURE_COMPLETION_TRACKS_VIEWS => true,
        FEATURE_GRADE_HAS_GRADE => false,
        FEATURE_GRADE_OUTCOMES => false,
        FEATURE_BACKUP_MOODLE2 => true,
        FEATURE_SHOW_DESCRIPTION => true,
        FEATURE_MOD_PURPOSE => MOD_PURPOSE_CONTENT,
        default => null,
    };
}

/**
 * STEP Learn が中身を見分ける鍵。
 *
 * @return string
 */
function stepbundle_new_key(): string {
    return random_string(22);
}

/**
 * @param \stdClass $data
 * @param \moodleform|null $mform
 * @return int
 */
function stepbundle_add_instance($data, $mform = null) {
    global $DB;
    $data->timemodified = time();
    $data->bundlekey = stepbundle_new_key();
    $data->id = $DB->insert_record('stepbundle', $data);
    $expected = !empty($data->completionexpected) ? $data->completionexpected : null;
    \core_completion\api::update_completion_date_event($data->coursemodule, 'stepbundle', $data->id, $expected);
    return $data->id;
}

/**
 * @param \stdClass $data
 * @param \moodleform|null $mform
 * @return bool
 */
function stepbundle_update_instance($data, $mform = null) {
    global $DB;
    $data->timemodified = time();
    $data->id = $data->instance;
    // 鍵を書き換えさせないのは、変わると STEP Learn にある配布するファイルと結び付かなくなるため
    unset($data->bundlekey);
    $DB->update_record('stepbundle', $data);
    $expected = !empty($data->completionexpected) ? $data->completionexpected : null;
    \core_completion\api::update_completion_date_event($data->coursemodule, 'stepbundle', $data->id, $expected);
    return true;
}

/**
 * @param int $id
 * @return bool
 */
function stepbundle_delete_instance($id) {
    global $DB;
    if (!$DB->record_exists('stepbundle', ['id' => $id])) {
        return false;
    }
    $cm = get_coursemodule_from_instance('stepbundle', $id);
    if ($cm) {
        \core_completion\api::update_completion_date_event($cm->id, 'stepbundle', $id, null);
    }
    $DB->delete_records('stepbundle', ['id' => $id]);
    return true;
}

/**
 * コースの一覧に載せる情報。鍵を customdata に入れ、STEP Learn が core_course_get_contents で読めるようにする。
 *
 * @param \stdClass $coursemodule
 * @return \cached_cm_info|false
 */
function stepbundle_get_coursemodule_info($coursemodule) {
    global $DB;
    $bundle = $DB->get_record('stepbundle', ['id' => $coursemodule->instance], 'id, name, intro, introformat, bundlekey');
    if (!$bundle) {
        return false;
    }
    $info = new \cached_cm_info();
    $info->name = $bundle->name;
    if ($coursemodule->showdescription) {
        $info->content = format_module_intro('stepbundle', $bundle, $coursemodule->id, false);
    }
    $info->customdata = ['key' => $bundle->bundlekey];
    return $info;
}

/**
 * 開いたことを記録し、「開いたら完了」の条件を満たす。
 *
 * @param \stdClass $bundle
 * @param \stdClass $course
 * @param \stdClass|\cm_info $cm
 * @param \context_module $context
 */
function stepbundle_view($bundle, $course, $cm, $context): void {
    global $CFG;
    require_once($CFG->libdir . '/completionlib.php');
    $event = \mod_stepbundle\event\course_module_viewed::create(['context' => $context, 'objectid' => $bundle->id]);
    $event->add_record_snapshot('course', $course);
    $event->add_record_snapshot('stepbundle', $bundle);
    $event->trigger();
    (new \completion_info($course))->set_module_viewed($cm);
}
