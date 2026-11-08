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

namespace local_steplearn;

/**
 * 活動の作成・更新に渡す moduleinfo を、編集フォームを使わずに組み立てる。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class modules {
    /** @var string[] STEP Learn の完了の条件。keep は今の設定を変えない（Moodle の画面で設定した条件を残す） */
    const COMPLETIONS = ['none', 'manual', 'view', 'keep'];

    /** @var string[] STEP Learn の開き方。keep は今の表示方法を変えない（新しく作るときはサイトの既定値） */
    const DISPLAYS = ['new', 'same', 'embed', 'keep'];

    /**
     * @param \stdClass $course
     * @param string $modname
     * @param int $sectionid
     * @param string $name
     * @param bool $visible
     * @return \stdClass
     */
    public static function create(\stdClass $course, string $modname, int $sectionid, string $name, bool $visible): \stdClass {
        global $CFG, $DB;
        require_once($CFG->dirroot . '/course/modlib.php');
        require_once($CFG->libdir . '/resourcelib.php');
        $section = $DB->get_record('course_sections', ['id' => $sectionid, 'course' => $course->id]);
        if (!$section) {
            throw new \moodle_exception('notfound', 'local_steplearn');
        }
        $data = (object) [
            'modulename' => $modname,
            'course' => $course->id,
            'section' => (int) $section->section,
            'visible' => (int) $visible,
            'visibleoncoursepage' => 1,
            'cmidnumber' => '',
            'groupmode' => 0,
            'groupingid' => 0,
            'availability' => null,
            'completion' => COMPLETION_TRACKING_NONE,
            'completionview' => 0,
            'completionexpected' => 0,
            'completionpassgrade' => 0,
            'completiongradeitemnumber' => null,
            'name' => $name,
            'introeditor' => ['text' => '', 'format' => FORMAT_HTML, 'itemid' => file_get_unused_draft_itemid()],
        ];
        // サイトの既定値を写すのは、編集フォームで作ったときと同じ表示の設定にするため
        foreach ((array) get_config($modname) as $key => $value) {
            if (in_array($key, ['display', 'popupwidth', 'popupheight', 'printintro', 'showsize', 'showtype', 'showdate'])) {
                $data->$key = $value;
            }
        }
        $data->display = $data->display ?? RESOURCELIB_DISPLAY_AUTO;
        return $data;
    }

    /**
     * 既存の活動の、編集フォームの初期値と同じ形の moduleinfo。
     *
     * @param \stdClass $course
     * @param int $cmid
     * @param string $modname
     * @return array{0: \stdClass, 1: \context_module}
     */
    public static function load(\stdClass $course, int $cmid, string $modname): array {
        global $CFG;
        require_once($CFG->dirroot . '/course/modlib.php');
        $cm = get_coursemodule_from_id($modname, $cmid, $course->id);
        if (!$cm) {
            throw new \moodle_exception('notfound', 'local_steplearn');
        }
        [, $context, , $data] = get_moduleinfo_data($cm, $course);
        // フォームの data_preprocessing と同じく展開しないと、更新時に表示の設定や URL のパラメーターが消える
        foreach ((array) unserialize_array($data->displayoptions ?? '') as $key => $value) {
            $data->$key = $value;
        }
        $i = 0;
        foreach ((array) unserialize_array($data->parameters ?? '') as $parameter => $variable) {
            $data->{'parameter_' . $i} = $parameter;
            $data->{'variable_' . $i} = $variable;
            $i++;
        }
        return [$data, $context];
    }

    /**
     * @param \stdClass $data
     * @param string $display new / same / embed / keep
     */
    public static function set_display(\stdClass $data, string $display): void {
        global $CFG;
        require_once($CFG->libdir . '/resourcelib.php');
        if ($display === 'keep') {
            return;
        }
        $data->display = match ($display) {
            'new' => RESOURCELIB_DISPLAY_NEW,
            'embed' => RESOURCELIB_DISPLAY_EMBED,
            default => RESOURCELIB_DISPLAY_OPEN,
        };
        // 編集フォームの既定値で補うのは、ポップアップなどから変えたときに、説明を表示しない設定になってしまうため
        $data->printintro = $data->printintro ?? get_config($data->modulename, 'printintro');
    }

    /**
     * @param \stdClass $data
     * @param string $completion none / manual / view / keep
     * @param bool $existing 既存の活動か
     */
    public static function set_completion(\stdClass $data, string $completion, bool $existing): void {
        if ($completion === 'keep') {
            return;
        }
        [$tracking, $view] = match ($completion) {
            'manual' => [COMPLETION_TRACKING_MANUAL, 0],
            'view' => [COMPLETION_TRACKING_AUTOMATIC, 1],
            default => [COMPLETION_TRACKING_NONE, 0],
        };
        // 変わったときだけにするのは、completionunlocked を立てると学生の完了の記録がすべて消えるため
        if ($existing && ((int) $data->completion !== $tracking || (int) $data->completionview !== $view)) {
            $data->completionunlocked = 1;
        }
        $data->completion = $tracking;
        $data->completionview = $view;
    }
}
