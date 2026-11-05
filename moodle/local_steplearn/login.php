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
 * Moodle でログインさせてから、使い捨てのコードを付けて STEP Learn に戻す。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require(__DIR__ . '/../../config.php');

$state = required_param('state', PARAM_ALPHANUMEXT);
$challenge = required_param('code_challenge', PARAM_ALPHANUMEXT);

$url = new moodle_url('/local/steplearn/login.php', ['state' => $state, 'code_challenge' => $challenge]);
$PAGE->set_url($url);
$PAGE->set_context(context_system::instance());

$appurl = \local_steplearn\app::url();
if (strlen($state) < 32 || strlen($state) > 128 || strlen($challenge) !== 43) {
    throw new moodle_exception('invalidrequest', 'local_steplearn');
}

// require_login() で済ませないのは、ゲストでのログインを通してしまうため
if (!isloggedin() || isguestuser()) {
    if (isguestuser()) {
        require_logout();
    }
    $SESSION->wantsurl = $url->out(false);
    redirect(get_login_url());
}
core_user::require_active_user($USER, true, true);

$code = \local_steplearn\codes::create($USER->id, $challenge, session_id());
redirect(new moodle_url($appurl . '/auth/moodle/callback', ['code' => $code, 'state' => $state]));
