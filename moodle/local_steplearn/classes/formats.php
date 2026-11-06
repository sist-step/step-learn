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

use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;

/**
 * コースフォーマットごとの表示の設定。STEP Learn が同じ見せ方をするのに使う。
 *
 * 折りたたみ型トピック（format_topcoll）とタイル（format_tiles）はサードパーティのプラグインなので、
 * 入っていないサイトでも動くように、そのコースで使われているときだけクラスに触れる。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class formats {
    /**
     * @param \stdClass $course
     * @return array
     */
    public static function export(\stdClass $course): array {
        $format = course_get_format($course);
        $result = ['name' => $format->get_format()];
        if ($result['name'] === 'topcoll' && method_exists($format, 'get_shown_sections') && method_exists($format, 'get_settings')) {
            $result['topcoll'] = self::topcoll($format);
        }
        if ($result['name'] === 'tiles' && class_exists('\format_tiles\local\format_option')) {
            $result['tiles'] = self::tiles($format, $course);
        }
        return $result;
    }

    /**
     * @param \core_courseformat\base $format format_topcoll
     * @return array
     */
    private static function topcoll(\core_courseformat\base $format): array {
        $settings = $format->get_settings();
        $shown = $format->get_shown_sections();
        $displayed = array_values($shown['sectionsdisplayed']);
        $current = 0;
        foreach ($displayed as $section) {
            if ($shown['currentsectionno'] && $section->section == $shown['currentsectionno']) {
                $current = (int) $section->id;
            }
        }
        $persistent = (int) get_config('format_topcoll', 'defaulttogglepersistence') === 1;
        if ($persistent) {
            $collapsed = $format->get_sections_preferences_by_preference()['contentcollapsed'] ?? [];
        } else {
            $allclosed = (int) get_config('format_topcoll', 'defaultuserpreference') === 0;
            $collapsed = $allclosed ? array_map(fn($section) => $section->id, $displayed) : [];
        }
        // 現在のセクションを閉じたものから外すのは、折りたたみ型トピックが開閉の記録にかかわらず開いて表示するため
        $collapsed = array_values(array_diff(array_map('intval', $collapsed), [$current]));

        return [
            'order' => array_map(fn($section) => (int) $section->id, $displayed),
            'collapsed' => $collapsed,
            'current' => $current,
            'toggleall' => (int) $settings['toggleallenabled'] === 2,
            'onesection' => (int) $settings['onesection'] === 2,
            'columns' => max(1, min(4, (int) $settings['layoutcolumns'])),
            'summarywhencollapsed' => (int) $settings['showsectionsummary'] === 2,
            'persistent' => $persistent,
        ];
    }

    /**
     * @param \core_courseformat\base $format format_tiles
     * @param \stdClass $course
     * @return array
     */
    private static function tiles(\core_courseformat\base $format, \stdClass $course): array {
        $options = $format->get_format_options();
        $context = \context_course::instance($course->id);
        $allowphotos = (bool) get_config('format_tiles', 'allowphototiles');
        $allowsubtiles = (bool) get_config('format_tiles', 'allowsubtilesview');
        $tiles = [];
        foreach (get_fast_modinfo($course)->get_section_info_all() as $section) {
            if ($section->section == 0 || $section->component) {
                continue;
            }
            $icon = \format_tiles\local\format_option::get(
                $course->id,
                \format_tiles\local\format_option::OPTION_SECTION_ICON,
                $section->id
            );
            $photourl = '';
            $file = $allowphotos ? (new \format_tiles\local\tile_photo($context, $section->id))->get_file() : null;
            if ($file) {
                $photourl = \moodle_url::make_webservice_pluginfile_url(
                    $file->get_contextid(),
                    $file->get_component(),
                    $file->get_filearea(),
                    $file->get_itemid(),
                    $file->get_filepath(),
                    $file->get_filename()
                )->out(false);
            }
            $tiles[] = ['sectionid' => (int) $section->id, 'icon' => $icon ?? '', 'photourl' => $photourl];
        }

        return [
            'defaulticon' => (string) ($options['defaulttileicon'] ?? ''),
            'progress' => (int) ($options['courseshowtileprogress'] ?? 0),
            'subtiles' => $allowsubtiles && !empty($options['courseusesubtiles']),
            'subtileszero' => $allowsubtiles && !empty($options['courseusesubtiles']) && !empty($options['usesubtilesseczero']),
            'tiles' => $tiles,
        ];
    }

    /**
     * @return external_single_structure
     */
    public static function structure(): external_single_structure {
        return new external_single_structure([
            'name' => new external_value(PARAM_PLUGIN, 'course format'),
            'topcoll' => new external_single_structure([
                'order' => new external_multiple_structure(new external_value(PARAM_INT, 'section id'), 'sections in display order'),
                'collapsed' => new external_multiple_structure(new external_value(PARAM_INT, 'section id'), 'collapsed sections'),
                'current' => new external_value(PARAM_INT, 'current section id or 0'),
                'toggleall' => new external_value(PARAM_BOOL, 'show open all / close all'),
                'onesection' => new external_value(PARAM_BOOL, 'only one section open at a time'),
                'columns' => new external_value(PARAM_INT, 'number of columns (1-4)'),
                'summarywhencollapsed' => new external_value(PARAM_BOOL, 'show the section summary while collapsed'),
                'persistent' => new external_value(PARAM_BOOL, 'toggle state is saved per user'),
            ], 'Collapsed Topics settings', VALUE_OPTIONAL),
            'tiles' => new external_single_structure([
                'defaulticon' => new external_value(PARAM_TEXT, 'course default tile icon'),
                'progress' => new external_value(PARAM_INT, '0 hide, 1 fraction, 2 percent'),
                'subtiles' => new external_value(PARAM_BOOL, 'show activities as tiles'),
                'subtileszero' => new external_value(PARAM_BOOL, 'show activities in section 0 as tiles'),
                'tiles' => new external_multiple_structure(new external_single_structure([
                    'sectionid' => new external_value(PARAM_INT, 'section id'),
                    'icon' => new external_value(PARAM_TEXT, 'tile icon or empty for the course default'),
                    'photourl' => new external_value(PARAM_URL, 'tile photo (webservice/pluginfile.php) or empty'),
                ])),
            ], 'Tiles settings', VALUE_OPTIONAL),
        ]);
    }
}
