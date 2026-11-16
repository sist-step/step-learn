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
 * Event observers.
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$observers = [
    [
        'eventname' => '\core\event\user_loggedout',
        'callback' => '\local_steplearn\observer::user_loggedout',
    ],
    ...array_map(fn(string $eventname) => [
        'eventname' => $eventname,
        'callback' => '\local_steplearn\observer::course_changed',
    ], [
        '\core\event\course_updated',
        '\core\event\course_restored',
        '\core\event\course_section_created',
        '\core\event\course_section_updated',
        '\core\event\course_section_deleted',
        '\core\event\course_module_created',
        '\core\event\course_module_updated',
        '\core\event\course_module_deleted',
    ]),
];
