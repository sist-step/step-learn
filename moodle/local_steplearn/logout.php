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
// /login/logout.php と違って sesskey を求めないのは、STEP Learn から移ってくるときには sesskey を知る手段がないため。
// 他のサイトから踏ませられてもログアウトするだけで、戻り先も固定なので害は小さい
if (isloggedin()) {
    require_logout();
}
redirect(new moodle_url($appurl . '/login', ['loggedout' => 1]));
