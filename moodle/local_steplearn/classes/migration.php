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
 * STEP Learn の移行ツール（npm run moodle:migrate）が、参加者と学生のファイルを読むときの権限。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class migration {
    /**
     * 参加者と学生のデータまで読めるコースを取得する。
     *
     * 教材を編集できるかで決めないのは、教師にも学生の個人情報をまとめて持ち出させることになるため。
     * ユーザーを含めたバックアップを作れる人と同じ権限にしている
     *
     * @param int $courseid
     * @return \stdClass
     */
    public static function require_course(int $courseid): \stdClass {
        global $DB;
        $course = $DB->get_record('course', ['id' => $courseid]);
        if (!$course) {
            throw new \moodle_exception('notfound', 'local_steplearn');
        }
        $context = \context_course::instance($course->id);
        require_capability('moodle/backup:backupcourse', $context);
        require_capability('moodle/backup:userinfo', $context);
        return $course;
    }
}
