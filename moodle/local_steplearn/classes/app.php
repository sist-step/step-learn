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
 * プラグインの設定。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class app {
    /** @var string STEP Learn が利用者ごとのトークンで使うサービスの短縮名 */
    const SERVICE = 'local_steplearn';

    /**
     * 末尾のスラッシュを除いた STEP Learn のオリジン。
     *
     * @return string
     */
    public static function url(): string {
        $url = rtrim((string) get_config('local_steplearn', 'appurl'), '/');
        if ($url === '') {
            throw new \moodle_exception('notconfigured', 'local_steplearn');
        }
        return $url;
    }

    /**
     * ログアウトを知らせる先。設定されていなければ null。
     *
     * @return array{url: string, secret: string}|null
     */
    public static function backchannel(): ?array {
        $secret = (string) get_config('local_steplearn', 'backchannelsecret');
        $appurl = rtrim((string) get_config('local_steplearn', 'appurl'), '/');
        if ($secret === '' || $appurl === '') {
            return null;
        }
        $url = (string) get_config('local_steplearn', 'backchannelurl');
        return ['url' => $url !== '' ? $url : $appurl . '/auth/moodle/backchannel-logout', 'secret' => $secret];
    }
}
