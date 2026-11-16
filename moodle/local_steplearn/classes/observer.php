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

/**
 * イベントの監視。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class observer {
    /**
     * この Moodle のセッションから始めた STEP Learn のセッションを終わらせるよう知らせる。
     *
     * @param \core\event\user_loggedout $event
     */
    public static function user_loggedout(\core\event\user_loggedout $event): void {
        $sid = $event->other['sessionid'] ?? '';
        if ($sid !== '') {
            backchannel::send(['sid' => hash('sha256', $sid), 'time' => time()]);
        }
    }

    /**
     * 開いている STEP Learn の画面に早く反映するよう、コースの内容が変わったことを知らせる。
     *
     * @param \core\event\base $event
     */
    public static function course_changed(\core\event\base $event): void {
        backchannel::course_changed((int) $event->courseid);
    }
}
