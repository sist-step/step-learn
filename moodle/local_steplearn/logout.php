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
 * STEP Learn からのログアウトに合わせて Moodle からもログアウトし、STEP Learn のログイン画面に戻す。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require(__DIR__ . '/../../config.php');

$PAGE->set_url(new moodle_url('/local/steplearn/logout.php'));
$PAGE->set_context(context_system::instance());

$appurl = \local_steplearn\app::url();
$loggedout = new moodle_url($appurl . '/login', ['loggedout' => 1]);
if (!isloggedin()) {
    redirect($loggedout);
}

// sesskey の代わりに署名で確かめるのは、STEP Learn から移ってくるときには sesskey を知る手段がないため。
// 署名に Moodle のセッションを含めるのは、攻撃者が自分のログアウトで得た URL を踏ませても、ほかの人をログアウトさせられないようにするため
$time = optional_param('time', 0, PARAM_INT);
$sig = optional_param('sig', '', PARAM_ALPHANUM);
$backchannel = \local_steplearn\app::backchannel();
$signed = $backchannel && $sig !== '' && abs(time() - $time) <= 300 && hash_equals(
    hash_hmac('sha256', 'logout.' . hash('sha256', session_id()) . '.' . $time, $backchannel['secret']),
    $sig
);
$sesskey = optional_param('sesskey', '', PARAM_RAW);
if ($signed || ($sesskey !== '' && confirm_sesskey($sesskey))) {
    require_logout();
    redirect($loggedout);
}

// 署名がないときにそのままログアウトしないのは、他のサイトから踏ませるだけで Moodle と STEP Learn の両方からログアウトさせられるため
echo $OUTPUT->header();
echo $OUTPUT->confirm(
    get_string('logoutconfirm'),
    new moodle_url('/local/steplearn/logout.php', ['sesskey' => sesskey()]),
    new moodle_url('/')
);
echo $OUTPUT->footer();
