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
 * 日本語の文字列。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'STEP Learn';
$string['appurl'] = 'STEP Learn の URL';
$string['appurl_desc'] = 'STEP Learn のオリジン（例: https://lms.example.com）。ログインやログアウトのあと、ここに戻します。';
$string['backchannelurl'] = 'ログアウトの通知先';
$string['backchannelurl_desc'] = 'Moodle でログアウトしたことを STEP Learn に知らせる URL。空なら STEP Learn の URL に /auth/moodle/backchannel-logout を付けたものを使います。';
$string['backchannelsecret'] = 'ログアウトの通知の鍵';
$string['backchannelsecret_desc'] = 'STEP Learn の MOODLE_BACKCHANNEL_SECRET と同じ値（32 文字以上）。空なら通知しません。';
$string['tokeniprestriction'] = 'トークンの IP 制限';
$string['tokeniprestriction_desc'] = 'STEP Learn のサーバーの IP アドレス（カンマ区切り）。STEP Learn 用に発行するトークンを、このアドレスからだけ使えるようにします。空なら制限しません。';
$string['banner'] = '新しい STEP Learn を案内する';
$string['banner_desc'] = 'ログイン画面とダッシュボードに、新しい STEP Learn に移るボタンを出します。文言は「言語のカスタマイズ」の bannermessage・bannerbutton で変えられます。';
$string['bannerbutton'] = '使ってみる';
$string['bannermessage'] = '新しい STEP Learn ができました。使いやすくなったSTEP Learnを使ってみてください！\n 開発状態にあるため、(見た目や機能に変更が加わることがあります。)';
$string['invalidcode'] = 'ログインのコードが正しくないか、期限が切れています。';
$string['invalidrequest'] = 'STEP Learn からのログインの要求が正しくありません。';
$string['notconfigured'] = 'STEP Learn の URL が設定されていません。';
$string['notfound'] = '見つかりません。';
$string['privacy:metadata:codes'] = 'STEP Learn にログインを引き継ぐための使い捨てのコード。使われるか 60 秒たつと消します。';
$string['privacy:metadata:codes:userid'] = 'ログインしたユーザー';
$string['privacy:metadata:codes:timecreated'] = 'コードを発行した日時';
$string['privacy:metadata:steplearn'] = 'ログインのあと、STEP Learn にユーザーの情報と Web サービスのトークンを渡します。';
$string['privacy:metadata:steplearn:userid'] = 'ユーザー ID';
$string['privacy:metadata:steplearn:username'] = 'ユーザー名';
$string['privacy:metadata:steplearn:fullname'] = '氏名';
$string['privacy:metadata:steplearn:email'] = 'メールアドレス';
$string['steplearn:exchangecode'] = 'ログインのコードを STEP Learn のトークンに交換する';
