<?php
// 検証環境専用の設定。本番の config.php には使わない

unset($CFG);
global $CFG;
$CFG = new stdClass();

$CFG->dbtype = 'pgsql';
$CFG->dblibrary = 'native';
$CFG->dbhost = 'db';
$CFG->dbname = 'moodle';
$CFG->dbuser = 'moodle';
$CFG->dbpass = 'moodle';
$CFG->prefix = 'mdl_';
$CFG->dboptions = [];

$CFG->wwwroot = 'http://localhost:8080';
$CFG->dataroot = '/var/www/moodledata';
$CFG->admin = 'admin';
$CFG->directorypermissions = 02777;
$CFG->routerconfigured = true;
$CFG->debug = E_ALL;
$CFG->debugdisplay = 1;

// 既定のままにしないのは、ホストの STEP Learn（host.docker.internal = プライベート IP）へのログアウト通知が curl のセキュリティ設定で止められるため
$CFG->curlsecurityblockedhosts = '';
$CFG->curlsecurityallowedport = '';

require_once(__DIR__ . '/lib/setup.php');
