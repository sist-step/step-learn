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
 * STEP Learn への署名付きの通知。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class backchannel {
    /** @var array<int, int> 要求の終わりに知らせる、内容が変わったコース */
    private static array $changedcourses = [];

    /**
     * コースの内容が変わったことを、要求の終わりにまとめて知らせる。
     *
     * @param int $courseid
     */
    public static function course_changed(int $courseid): void {
        if ($courseid <= SITEID || !app::backchannel()) {
            return;
        }
        // その場で送らないのは、リストアや一括の編集では 1 回の要求で何百ものイベントが起き、そのたびに STEP Learn を呼ぶことになるため
        // 終わりに送るのは、トランザクションの途中で知らせると、STEP Learn が確定前の内容を取り直してしまうため
        if (!self::$changedcourses) {
            \core_shutdown_manager::register_function([self::class, 'send_changed_courses']);
        }
        self::$changedcourses[$courseid] = $courseid;
    }

    /**
     * 集めたコースを知らせる。
     */
    public static function send_changed_courses(): void {
        $courses = array_values(self::$changedcourses);
        self::$changedcourses = [];
        if ($courses) {
            self::send(['courses' => $courses, 'time' => time()]);
        }
    }

    /**
     * 通知を送る。設定されていなければ何もしない。
     *
     * @param array $notice
     */
    public static function send(array $notice): void {
        global $CFG;
        $backchannel = app::backchannel();
        if (!$backchannel) {
            return;
        }
        require_once($CFG->libdir . '/filelib.php');
        $body = json_encode($notice);
        // 例外を外に出さないのは、STEP Learn が止まっているときに Moodle の操作（ログアウトや教材の編集）まで失敗させないため
        try {
            $curl = new \curl();
            $curl->setHeader([
                'Content-Type: application/json',
                'X-Steplearn-Signature: ' . hash_hmac('sha256', $body, $backchannel['secret']),
            ]);
            $curl->post($backchannel['url'], $body, ['CURLOPT_TIMEOUT' => 3, 'CURLOPT_CONNECTTIMEOUT' => 2]);
            if ($curl->get_errno() || ($curl->get_info()['http_code'] ?? 0) >= 300) {
                debugging('STEP Learn notification failed: ' . $curl->error, DEBUG_DEVELOPER);
            }
        } catch (\Throwable $e) {
            debugging('STEP Learn notification failed: ' . $e->getMessage(), DEBUG_DEVELOPER);
        }
    }
}
