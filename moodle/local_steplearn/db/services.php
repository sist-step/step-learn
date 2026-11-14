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
 * External functions and services.
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$functions = [
    'local_steplearn_exchange_code' => [
        'classname' => 'local_steplearn\external\exchange_code',
        'description' => 'Exchange a one-time login code for a STEP Learn web service token.',
        'type' => 'write',
        'capabilities' => 'local/steplearn:exchangecode',
    ],
    'local_steplearn_get_my_courses' => [
        'classname' => 'local_steplearn\external\get_my_courses',
        'description' => 'Courses the current user is enrolled in, with role and progress.',
        'type' => 'read',
    ],
    'local_steplearn_get_other_courses' => [
        'classname' => 'local_steplearn\external\get_other_courses',
        'description' => 'Courses the current user is not enrolled in, for users who can view all courses.',
        'type' => 'read',
        'capabilities' => 'moodle/course:view',
    ],
    'local_steplearn_get_course' => [
        'classname' => 'local_steplearn\external\get_course',
        'description' => 'A course the current user can access, with role and progress.',
        'type' => 'read',
    ],
    'local_steplearn_create_section' => [
        'classname' => 'local_steplearn\external\create_section',
        'description' => 'Add a section at the end of a course.',
        'type' => 'write',
        'capabilities' => 'moodle/course:update',
    ],
    'local_steplearn_update_section' => [
        'classname' => 'local_steplearn\external\update_section',
        'description' => 'Rename a section and change its summary.',
        'type' => 'write',
        'capabilities' => 'moodle/course:update',
    ],
    'local_steplearn_save_url' => [
        'classname' => 'local_steplearn\external\save_url',
        'description' => 'Create or update a URL activity.',
        'type' => 'write',
        'capabilities' => 'moodle/course:manageactivities, mod/url:addinstance',
    ],
    'local_steplearn_save_resource' => [
        'classname' => 'local_steplearn\external\save_resource',
        'description' => 'Create or update a file activity from a draft area.',
        'type' => 'write',
        'capabilities' => 'moodle/course:manageactivities, mod/resource:addinstance',
    ],
    'local_steplearn_get_restrictions' => [
        'classname' => 'local_steplearn\external\get_restrictions',
        'description' => 'Access restrictions of the sections and activities in a course, for users who can edit it.',
        'type' => 'read',
        'capabilities' => 'moodle/course:manageactivities',
    ],
    'local_steplearn_set_restriction' => [
        'classname' => 'local_steplearn\external\set_restriction',
        'description' => 'Replace the access restriction of a section or an activity.',
        'type' => 'write',
        'capabilities' => 'moodle/course:manageactivities',
    ],
    'local_steplearn_set_sections_collapsed' => [
        'classname' => 'local_steplearn\external\set_sections_collapsed',
        'description' => 'Remember which sections the current user collapsed on the course page.',
        'type' => 'write',
    ],
    'local_steplearn_check_session' => [
        'classname' => 'local_steplearn\external\check_session',
        'description' => 'Whether the Moodle session a STEP Learn session started from is still active. Extends it if so.',
        'type' => 'write',
    ],
];

$services = [
    'STEP Learn' => [
        'shortname' => 'local_steplearn',
        'functions' => [
            'core_webservice_get_site_info',
            'core_course_get_contents',
            'core_course_view_course',
            'core_courseformat_update_course',
            'core_completion_update_activity_completion_status_manually',
            'mod_url_view_url',
            'mod_resource_view_resource',
            // mod_stepbundle（ファイル自動配布）の側から足さないのは、このサービスで呼べる関数をこの一覧だけで見渡せるようにするため。
            // mod_stepbundle を入れていない Moodle では、呼べない名前として残るだけになる
            'mod_stepbundle_save',
            'mod_stepbundle_view',
            'local_steplearn_get_my_courses',
            'local_steplearn_get_other_courses',
            'local_steplearn_get_course',
            'local_steplearn_create_section',
            'local_steplearn_update_section',
            'local_steplearn_save_url',
            'local_steplearn_save_resource',
            'local_steplearn_get_restrictions',
            'local_steplearn_set_restriction',
            'local_steplearn_set_sections_collapsed',
            'local_steplearn_check_session',
        ],
        'restrictedusers' => 0,
        'enabled' => 1,
        'downloadfiles' => 1,
        'uploadfiles' => 1,
    ],
    'STEP Learn exchange' => [
        'shortname' => 'local_steplearn_exchange',
        'functions' => ['local_steplearn_exchange_code'],
        'restrictedusers' => 1,
        'enabled' => 1,
    ],
];
