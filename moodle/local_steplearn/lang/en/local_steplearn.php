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
 * English strings.
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'STEP Learn';
$string['appurl'] = 'STEP Learn URL';
$string['appurl_desc'] = 'Origin of STEP Learn, e.g. https://lms.example.com. Users are sent back here after logging in or out.';
$string['backchannelurl'] = 'Logout notification URL';
$string['backchannelurl_desc'] = 'Where Moodle notifies STEP Learn when a user logs out. Leave empty to use the STEP Learn URL followed by /auth/moodle/backchannel-logout.';
$string['backchannelsecret'] = 'Logout notification secret';
$string['backchannelsecret_desc'] = 'Same value as MOODLE_BACKCHANNEL_SECRET in STEP Learn (32 characters or more). Leave empty to disable notifications.';
$string['tokeniprestriction'] = 'Token IP restriction';
$string['tokeniprestriction_desc'] = 'IP addresses of the STEP Learn server (comma separated). Tokens issued for STEP Learn can only be used from these addresses. Leave empty for no restriction.';
$string['invalidcode'] = 'The login code is invalid or has expired.';
$string['invalidrequest'] = 'The login request from STEP Learn is invalid.';
$string['notconfigured'] = 'The STEP Learn URL is not configured.';
$string['notfound'] = 'Not found.';
$string['privacy:metadata:codes'] = 'One-time codes that hand a login over to STEP Learn. They are deleted when used or after 60 seconds.';
$string['privacy:metadata:codes:userid'] = 'The user who logged in.';
$string['privacy:metadata:codes:timecreated'] = 'When the code was issued.';
$string['privacy:metadata:steplearn'] = 'STEP Learn receives the user\'s identity and a web service token after login.';
$string['privacy:metadata:steplearn:userid'] = 'The user id.';
$string['privacy:metadata:steplearn:username'] = 'The username.';
$string['privacy:metadata:steplearn:fullname'] = 'The full name.';
$string['privacy:metadata:steplearn:email'] = 'The email address.';
$string['steplearn:exchangecode'] = 'Exchange login codes for STEP Learn tokens';
