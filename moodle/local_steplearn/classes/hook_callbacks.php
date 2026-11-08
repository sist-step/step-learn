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

use core\hook\output\before_standard_top_of_body_html_generation;
use html_writer;

/**
 * 移行の期間に、ログイン画面とダッシュボードで新しい STEP Learn を案内する。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class hook_callbacks {
    /**
     * ログイン画面ではユーザー名の入力欄の上に出し、ダッシュボードでは通知として出す。
     *
     * @param before_standard_top_of_body_html_generation $hook
     */
    public static function before_standard_top_of_body_html_generation(before_standard_top_of_body_html_generation $hook): void {
        global $PAGE;

        $islogin = $PAGE->pagetype === 'login-index';
        // ページの種類（my-index）で見ないのは、「マイコース」も同じ種類を使っているため
        $isdashboard = $PAGE->pagelayout === 'mydashboard';
        if (!$islogin && !$isdashboard) {
            return;
        }
        if (!get_config('local_steplearn', 'banner')) {
            return;
        }
        // app::url() を使わないのは、未設定のときに例外になり、ログイン画面まで開けなくなるため
        $appurl = rtrim((string) get_config('local_steplearn', 'appurl'), '/');
        if ($appurl === '') {
            return;
        }

        if ($islogin) {
            if (!self::heading_to_steplearn()) {
                $hook->add_html(html_writer::div(
                    self::content($appurl),
                    'alert alert-info mb-4 d-none',
                    ['id' => 'local-steplearn-banner']
                ));
                // テンプレート（core/loginform）に差し込まず JS で移すのは、ローカルプラグインからはログインフォームのテンプレートを変えられないため
                // 移せなかったときも隠したままにしないのは、テーマがログイン画面の作りを変えていても案内は届けたいため
                $PAGE->requires->js_amd_inline(<<<'JS'
                    const banner = document.getElementById('local-steplearn-banner');
                    if (banner) {
                        document.querySelector('.loginform > .login-form')?.before(banner);
                        banner.classList.remove('d-none');
                    }
                    JS);
            }
        } else if (isloggedin() && !isguestuser()) {
            // ページの上端に出さないのは、ダッシュボードでは固定のナビゲーションバーの下に隠れるため
            \core\notification::add(self::content($appurl), \core\output\notification::NOTIFY_INFO);
        }
    }

    /**
     * STEP Learn の「旧STEP Learnでログイン」から来て、ログインの途中にいるか。
     *
     * @return bool
     */
    private static function heading_to_steplearn(): bool {
        global $SESSION;
        $loginurl = (new \moodle_url('/local/steplearn/login.php'))->out(false);
        return str_starts_with((string) ($SESSION->wantsurl ?? ''), $loginurl);
    }

    /**
     * 案内の文と、STEP Learn でログインを始めるボタン。
     *
     * @param string $appurl
     * @return string
     */
    private static function content(string $appurl): string {
        return html_writer::div(
            html_writer::span(get_string('bannermessage', 'local_steplearn')) .
                html_writer::link(
                    $appurl . '/auth/moodle/start',
                    get_string('bannerbutton', 'local_steplearn'),
                    // text-white を外さないのは、通知の中ではリンクの色が通知の文字色で上書きされ、ボタンの文字が読みにくくなるため
                    ['class' => 'btn btn-primary btn-sm text-white']
                ),
            'd-flex flex-wrap align-items-center gap-2'
        );
    }
}
