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
 * Admin settings.
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_steplearn', get_string('pluginname', 'local_steplearn'));
    $ADMIN->add('localplugins', $settings);

    $settings->add(new admin_setting_configtext(
        'local_steplearn/appurl',
        get_string('appurl', 'local_steplearn'),
        get_string('appurl_desc', 'local_steplearn'),
        '',
        PARAM_URL
    ));
    $settings->add(new admin_setting_configtext(
        'local_steplearn/backchannelurl',
        get_string('backchannelurl', 'local_steplearn'),
        get_string('backchannelurl_desc', 'local_steplearn'),
        '',
        PARAM_URL
    ));
    $settings->add(new admin_setting_configpasswordunmask(
        'local_steplearn/backchannelsecret',
        get_string('backchannelsecret', 'local_steplearn'),
        get_string('backchannelsecret_desc', 'local_steplearn'),
        ''
    ));
    $settings->add(new admin_setting_configtext(
        'local_steplearn/tokeniprestriction',
        get_string('tokeniprestriction', 'local_steplearn'),
        get_string('tokeniprestriction_desc', 'local_steplearn'),
        '',
        PARAM_TEXT
    ));
}
