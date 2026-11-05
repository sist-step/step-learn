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

namespace local_steplearn\external;

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_value;
use local_steplearn\courses;
use local_steplearn\modules;

/**
 * URL の活動を作る・変える。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class save_url extends external_api {
    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'course id'),
            'cmid' => new external_value(PARAM_INT, 'course module id to update, or 0 to create'),
            'sectionid' => new external_value(PARAM_INT, 'section to create in (ignored when updating)'),
            'name' => new external_value(PARAM_TEXT, 'name'),
            'externalurl' => new external_value(PARAM_URL, 'http(s) URL'),
            'completion' => new external_value(PARAM_ALPHA, 'none, manual, view or keep (updates only)'),
            'visible' => new external_value(PARAM_BOOL, 'visible to students (ignored when updating)', VALUE_DEFAULT, true),
        ]);
    }

    /**
     * @param int $courseid
     * @param int $cmid
     * @param int $sectionid
     * @param string $name
     * @param string $externalurl
     * @param string $completion
     * @param bool $visible
     * @return int course module id
     */
    public static function execute(
        int $courseid,
        int $cmid,
        int $sectionid,
        string $name,
        string $externalurl,
        string $completion,
        bool $visible = true
    ): int {
        global $CFG;
        $params = self::validate_parameters(self::execute_parameters(), compact(
            'courseid',
            'cmid',
            'sectionid',
            'name',
            'externalurl',
            'completion',
            'visible'
        ));
        self::validate_context(\context_system::instance());
        $course = courses::require_manage($params['courseid']);
        if (!preg_match('~^https?://~i', $params['externalurl']) || !in_array($params['completion'], modules::COMPLETIONS)) {
            throw new \invalid_parameter_exception('externalurl or completion');
        }
        require_once($CFG->dirroot . '/course/lib.php');

        if ($params['cmid']) {
            [$data] = modules::load($course, $params['cmid'], 'url');
            $data->name = $params['name'];
            $data->externalurl = $params['externalurl'];
            modules::set_completion($data, $params['completion'], true);
            update_module($data);
            return $params['cmid'];
        }
        $data = modules::create($course, 'url', $params['sectionid'], $params['name'], $params['visible']);
        $data->externalurl = $params['externalurl'];
        modules::set_completion($data, $params['completion'], false);
        return (int) create_module($data)->coursemodule;
    }

    /**
     * @return external_value
     */
    public static function execute_returns(): external_value {
        return new external_value(PARAM_INT, 'course module id');
    }
}
