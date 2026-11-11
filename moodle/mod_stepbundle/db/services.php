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
 * STEP Learn から呼ぶ Web サービスの関数。サービス「STEP Learn」への登録は local_steplearn の db/services.php にある。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$functions = [
    'mod_stepbundle_save' => [
        'classname' => 'mod_stepbundle\external\save',
        'description' => 'Create or update a file distribution activity.',
        'type' => 'write',
        'capabilities' => 'moodle/course:manageactivities, mod/stepbundle:addinstance',
    ],
    'mod_stepbundle_view' => [
        'classname' => 'mod_stepbundle\external\view',
        'description' => 'Record that the current user viewed a file distribution activity.',
        'type' => 'write',
        'capabilities' => 'mod/stepbundle:view',
    ],
];
