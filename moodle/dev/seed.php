<?php
// 検証環境に STEP Learn 連携の設定とテスト用のユーザー・コースを入れる。何度実行してもよい。
// 使い方: docker compose exec -u www-data moodle php /opt/steplearn-dev/seed.php

define('CLI_SCRIPT', true);
require('/var/www/html/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->libdir . '/testing/generator/lib.php');

const APP_URL = 'http://localhost:5174';
const BACKCHANNEL_URL = 'http://host.docker.internal:5174/auth/moodle/backchannel-logout';
const BACKCHANNEL_SECRET = 'dev-backchannel-secret-0123456789abcdef';

global $DB;
\core\session\manager::set_user(get_admin());
$generator = new testing_data_generator();
$system = context_system::instance();

set_config('enablewebservices', 1);
set_config('webserviceprotocols', 'rest');
set_config('enablecompletion', 1);
set_config('appurl', APP_URL, 'local_steplearn');
set_config('backchannelurl', BACKCHANNEL_URL, 'local_steplearn');
set_config('backchannelsecret', BACKCHANNEL_SECRET, 'local_steplearn');
set_config('banner', 1, 'local_steplearn');

$authenticated = $DB->get_record('role', ['shortname' => 'user'], '*', MUST_EXIST);
assign_capability('webservice/rest:use', CAP_ALLOW, $authenticated->id, $system->id, true);

// パスワードを推測されにくいものにしないのは、検証環境のユーザーを切り替えてログインし直すことが多いため
function ensure_user(testing_data_generator $generator, string $username, string $firstname, string $lastname): stdClass {
    global $DB;
    return $DB->get_record('user', ['username' => $username, 'deleted' => 0]) ?: $generator->create_user([
        'username' => $username,
        'password' => $username,
        'firstname' => $firstname,
        'lastname' => $lastname,
        'email' => $username . '@example.com',
    ]);
}

$service = ensure_user($generator, 'steplearn_service', 'STEP Learn', 'サービス');
$roleid = $DB->get_field('role', 'id', ['shortname' => 'steplearn_exchange'])
    ?: create_role('STEP Learn 交換', 'steplearn_exchange', 'STEP Learn のログインのコードを交換する専用のロール');
set_role_contextlevels($roleid, [CONTEXT_SYSTEM]);
assign_capability('local/steplearn:exchangecode', CAP_ALLOW, $roleid, $system->id, true);
assign_capability('webservice/rest:use', CAP_ALLOW, $roleid, $system->id, true);
role_assign($roleid, $service->id, $system->id);
$exchange = $DB->get_record('external_services', ['shortname' => 'local_steplearn_exchange'], '*', MUST_EXIST);
if (!$DB->record_exists('external_services_users', ['externalserviceid' => $exchange->id, 'userid' => $service->id])) {
    $DB->insert_record('external_services_users', (object) [
        'externalserviceid' => $exchange->id,
        'userid' => $service->id,
        'timecreated' => time(),
    ]);
}
$token = $DB->get_field('external_tokens', 'token', ['externalserviceid' => $exchange->id, 'userid' => $service->id])
    ?: \core_external\util::generate_token(EXTERNAL_TOKEN_PERMANENT, $exchange, $service->id, $system, 0, '', 'STEP Learn exchange');
accesslib_clear_all_caches(true);

$teacher = ensure_user($generator, 'teacher', '花子', '先生');
$student = ensure_user($generator, 'student', '太郎', '学生');

$course = $DB->get_record('course', ['shortname' => 'moodle-mode']);
if (!$course) {
    $course = $generator->create_course([
        'fullname' => 'Moodle モード検証',
        'shortname' => 'moodle-mode',
        'summary' => '<p>STEP Learn の <strong>Moodle モード</strong>を確かめるためのコースです。</p>',
        'enablecompletion' => 1,
        'numsections' => 2,
        'format' => 'topics',
    ]);
    $generator->enrol_user($teacher->id, $course->id, 'editingteacher');
    $generator->enrol_user($student->id, $course->id, 'student');
}
if (!$DB->record_exists('course_modules', ['course' => $course->id])) {
    $generator->create_module('label', [
        'course' => $course->id,
        'section' => 1,
        'intro' => '<p>このセクションでは<em>リンク</em>と<em>ファイル</em>を確かめます。</p>',
    ]);
    $generator->create_module('url', [
        'course' => $course->id,
        'section' => 1,
        'name' => 'Moodle 公式サイト',
        'externalurl' => 'https://moodle.org/',
    ], ['completion' => COMPLETION_TRACKING_AUTOMATIC, 'completionview' => 1]);
    $generator->create_module('resource', [
        'course' => $course->id,
        'section' => 1,
        'name' => '配布資料',
        'defaultfilename' => 'handout.txt',
    ], ['completion' => COMPLETION_TRACKING_MANUAL]);
    $generator->create_module('assign', [
        'course' => $course->id,
        'section' => 2,
        'name' => 'レポート課題',
    ], ['completion' => COMPLETION_TRACKING_MANUAL]);
    $generator->create_module('url', [
        'course' => $course->id,
        'section' => 2,
        'name' => '非表示のリンク',
        'externalurl' => 'https://example.com/',
    ], ['visible' => 0]);
}

/**
 * コースフォーマットのプラグイン（タイル・折りたたみ型トピック）を入れているときだけ、確かめるためのコースを作る。
 */
function ensure_format_course(
    testing_data_generator $generator,
    string $format,
    string $fullname,
    array $options,
    array $users
): ?stdClass {
    global $DB;
    if (!core_component::get_component_directory('format_' . $format)) {
        return null;
    }
    $shortname = 'moodle-mode-' . $format;
    $course = $DB->get_record('course', ['shortname' => $shortname]);
    if ($course) {
        return $course;
    }
    $course = $generator->create_course([
        'fullname' => $fullname,
        'shortname' => $shortname,
        'summary' => '<p>コースフォーマットに合わせた表示を確かめるためのコースです。</p>',
        'enablecompletion' => 1,
        'numsections' => 5,
        'format' => $format,
    ] + $options);
    $generator->enrol_user($users[0]->id, $course->id, 'editingteacher');
    $generator->enrol_user($users[1]->id, $course->id, 'student');
    $generator->create_module('url', [
        'course' => $course->id,
        'section' => 0,
        'name' => 'シラバス',
        'externalurl' => 'https://example.com/syllabus',
    ]);
    for ($section = 1; $section <= 5; $section++) {
        $generator->create_module('url', [
            'course' => $course->id,
            'section' => $section,
            'name' => "第{$section}回 参考リンク",
            'externalurl' => "https://example.com/{$section}",
        ], ['completion' => COMPLETION_TRACKING_MANUAL]);
        $generator->create_module('resource', [
            'course' => $course->id,
            'section' => $section,
            'name' => "第{$section}回 資料",
            'defaultfilename' => "week{$section}.txt",
        ], ['completion' => COMPLETION_TRACKING_MANUAL]);
    }
    return $course;
}

$tiles = ensure_format_course(
    $generator,
    'tiles',
    'タイル形式の検証',
    ['courseshowtileprogress' => 1, 'defaulttileicon' => 'book'],
    [$teacher, $student]
);
if ($tiles) {
    $modinfo = get_fast_modinfo($tiles);
    foreach ([1 => 'flask', 2 => 'number_2', 3 => 'users'] as $number => $icon) {
        \format_tiles\local\format_option::set(
            $tiles->id,
            \format_tiles\local\format_option::OPTION_SECTION_ICON,
            $modinfo->get_section_info($number)->id,
            $icon
        );
    }
}
$topcoll = ensure_format_course($generator, 'topcoll', '折りたたみ型トピックの検証', [], [$teacher, $student]);

cli_writeln('MOODLE_URL=' . $CFG->wwwroot);
cli_writeln('MOODLE_EXCHANGE_TOKEN=' . $token);
cli_writeln('MOODLE_BACKCHANNEL_SECRET=' . BACKCHANNEL_SECRET);
cli_writeln('コース ID: ' . $course->id . '（teacher / student、パスワードはユーザー名と同じ）');
foreach (['タイル' => $tiles, '折りたたみ型トピック' => $topcoll] as $label => $formatcourse) {
    if ($formatcourse) {
        cli_writeln("{$label}のコース ID: {$formatcourse->id}");
    }
}
