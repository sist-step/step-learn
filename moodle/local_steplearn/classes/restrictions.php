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

use availability_profile\condition as profile_condition;
use core_availability\tree;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;

/**
 * アクセス制限の JSON（course_modules / course_sections の availability）の受け渡しと確認。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class restrictions {
    /** @var int 受け付ける JSON の長さの上限 */
    const MAX_JSON_LENGTH = 100000;

    /**
     * 教師向けの、すべての条件を書いた説明（HTML）。
     *
     * @param \core_availability\info $info
     * @param \stdClass $course
     * @return string
     */
    public static function describe(\core_availability\info $info, \stdClass $course): string {
        $full = $info->get_full_information();
        return $full ? \core_availability\info::format_info($full, $course) : '';
    }

    /**
     * @param int $sectionid
     * @param int $cmid
     * @param string|null $json
     * @param string $info
     * @return array
     */
    public static function export(int $sectionid, int $cmid, ?string $json, string $info): array {
        return ['sectionid' => $sectionid, 'cmid' => $cmid, 'info' => $info, 'json' => (string) $json];
    }

    /**
     * @return external_single_structure
     */
    public static function structure(): external_single_structure {
        return new external_single_structure([
            'sectionid' => new external_value(PARAM_INT, 'section id, or 0 for a course module'),
            'cmid' => new external_value(PARAM_INT, 'course module id, or 0 for a section'),
            'info' => new external_value(PARAM_RAW, 'all conditions as shown to teachers (HTML)'),
            'json' => new external_value(PARAM_RAW, 'the availability JSON'),
        ]);
    }

    /**
     * 編集画面で選べるもの（有効な条件の種類・評点の項目・プロフィールの項目）と、編集しない条件の説明に使う名前。
     *
     * @param \stdClass $course
     * @return array
     */
    public static function options(\stdClass $course): array {
        global $CFG;
        require_once($CFG->libdir . '/gradelib.php');
        require_once($CFG->dirroot . '/course/lib.php');
        $context = \context_course::instance($course->id);

        $plugins = array_keys(\core_plugin_manager::instance()->get_enabled_plugins('availability') ?? []);

        $grades = [];
        foreach (\grade_item::fetch_all(['courseid' => $course->id]) ?: [] as $item) {
            if (course_module_instance_pending_deletion($item->courseid, $item->itemmodule, $item->iteminstance)) {
                continue;
            }
            $cmid = 0;
            if ($item->itemtype === 'mod') {
                $cm = get_coursemodule_from_instance($item->itemmodule, $item->iteminstance, $course->id);
                $cmid = $cm ? (int) $cm->id : 0;
            }
            $grades[] = ['id' => (int) $item->id, 'name' => $item->get_name(true), 'cmid' => $cmid];
        }

        $fields = [];
        foreach (profile_condition::get_standard_profile_fields() as $name => $label) {
            $fields[] = ['field' => 'sf:' . $name, 'name' => (string) $label];
        }
        foreach (profile_condition::get_custom_profile_fields() as $field) {
            $fields[] = ['field' => 'cf:' . $field->shortname, 'name' => format_string($field->name, true, ['context' => $context])];
        }

        $groups = [];
        foreach (groups_get_all_groups($course->id) as $group) {
            $groups[] = ['id' => (int) $group->id, 'name' => format_string($group->name, true, ['context' => $context])];
        }
        $groupings = [];
        foreach (groups_get_all_groupings($course->id) as $grouping) {
            $groupings[] = ['id' => (int) $grouping->id, 'name' => format_string($grouping->name, true, ['context' => $context])];
        }

        return ['plugins' => $plugins, 'grades' => $grades, 'profilefields' => $fields, 'groups' => $groups, 'groupings' => $groupings];
    }

    /**
     * @return external_single_structure
     */
    public static function options_structure(): external_single_structure {
        $named = fn(string $desc) => new external_multiple_structure(new external_single_structure([
            'id' => new external_value(PARAM_INT, 'id'),
            'name' => new external_value(PARAM_RAW, 'name'),
        ]), $desc);
        return new external_single_structure([
            'plugins' => new external_multiple_structure(new external_value(PARAM_PLUGIN, 'plugin name'), 'enabled availability plugins'),
            'grades' => new external_multiple_structure(new external_single_structure([
                'id' => new external_value(PARAM_INT, 'grade item id'),
                'name' => new external_value(PARAM_RAW, 'grade item name'),
                'cmid' => new external_value(PARAM_INT, 'course module id of the activity, or 0'),
            ]), 'grade items of the course'),
            'profilefields' => new external_multiple_structure(new external_single_structure([
                'field' => new external_value(PARAM_RAW, 'sf:<standard field> or cf:<custom field shortname>'),
                'name' => new external_value(PARAM_RAW, 'field name'),
            ]), 'user profile fields'),
            'groups' => $named('groups of the course'),
            'groupings' => $named('groupings of the course'),
        ]);
    }

    /**
     * STEP Learn から送られた制限の JSON を確かめ、保存する値にする。空なら null（制限なし）。
     *
     * @param string $json
     * @param \stdClass $course
     * @param \course_modinfo $modinfo
     * @param \cm_info|null $self 制限を付ける活動（セクションなら null）
     * @return string|null
     */
    public static function validate(string $json, \stdClass $course, \course_modinfo $modinfo, ?\cm_info $self): ?string {
        if ($json === '') {
            return null;
        }
        $structure = strlen($json) <= self::MAX_JSON_LENGTH ? json_decode($json) : null;
        if (!is_object($structure)) {
            throw new \invalid_parameter_exception('availability');
        }
        // Moodle 自身の読み込みで形を確かめるのは、保存したあとに Moodle がコースの表示で読めなくなるのを防ぐため
        try {
            new tree($structure);
        } catch (\coding_exception $e) {
            throw new \invalid_parameter_exception('availability: ' . $e->getMessage());
        }
        $grades = array_column(self::options($course)['grades'], 'id');
        $groups = array_map('intval', array_keys(groups_get_all_groups($course->id)));
        $groupings = array_map('intval', array_keys(groups_get_all_groupings($course->id)));
        $completion = new \completion_info($course);
        $cms = $modinfo->get_cms();
        self::check_references($structure, function (\stdClass $c) use ($grades, $groups, $groupings, $completion, $cms, $self): bool {
            switch ($c->type) {
                case 'completion':
                    if (!$completion->is_enabled()) {
                        return false;
                    }
                    if ($c->cm === -1) {
                        return true;
                    }
                    $target = $cms[$c->cm] ?? null;
                    return $target && !$target->deletioninprogress && $target->id !== $self?->id
                        && $target->completion != COMPLETION_TRACKING_NONE;
                case 'grade':
                    return in_array($c->id, $grades, true);
                case 'group':
                    return !isset($c->id) || in_array($c->id, $groups, true);
                case 'grouping':
                    return !isset($c->id) || in_array($c->id, $groupings, true);
                default:
                    return true;
            }
        });
        return json_encode($structure);
    }

    /**
     * ほかのコースの活動や評点を条件に入れさせないため、条件ごとに参照先を確かめる。
     *
     * @param \stdClass $node
     * @param callable $valid
     */
    private static function check_references(\stdClass $node, callable $valid): void {
        if (isset($node->type)) {
            if (!$valid($node)) {
                throw new \invalid_parameter_exception('availability: ' . $node->type);
            }
            return;
        }
        foreach ($node->c as $child) {
            self::check_references($child, $valid);
        }
    }
}
