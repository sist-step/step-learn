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
        global $CFG;
        $sid = $event->other['sessionid'] ?? '';
        $backchannel = app::backchannel();
        if ($sid === '' || !$backchannel) {
            return;
        }
        require_once($CFG->libdir . '/filelib.php');
        $body = json_encode(['sid' => hash('sha256', $sid), 'time' => time()]);
        // 例外を外に出さないのは、STEP Learn が止まっているときに Moodle からログアウトできなくなるのを避けるため
        try {
            $curl = new \curl();
            $curl->setHeader([
                'Content-Type: application/json',
                'X-Steplearn-Signature: ' . hash_hmac('sha256', $body, $backchannel['secret']),
            ]);
            $curl->post($backchannel['url'], $body, ['CURLOPT_TIMEOUT' => 3, 'CURLOPT_CONNECTTIMEOUT' => 2]);
            if ($curl->get_errno() || ($curl->get_info()['http_code'] ?? 0) >= 300) {
                debugging('STEP Learn logout notification failed: ' . $curl->error, DEBUG_DEVELOPER);
            }
        } catch (\Throwable $e) {
            debugging('STEP Learn logout notification failed: ' . $e->getMessage(), DEBUG_DEVELOPER);
        }
    }
}
