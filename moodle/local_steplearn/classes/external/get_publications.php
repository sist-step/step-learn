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

namespace local_steplearn\external;

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use local_steplearn\migration;

/**
 * コースの学生フォルダ（mod_publication）の設定と、学生が上げたファイル。STEP Learn の移行ツールが使う。
 * mod_publication が入っていない Moodle では空を返す。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class get_publications extends external_api {
    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'course id'),
        ]);
    }

    /**
     * @param int $courseid
     * @return array
     */
    public static function execute(int $courseid): array {
        global $DB;
        ['courseid' => $courseid] = self::validate_parameters(self::execute_parameters(), ['courseid' => $courseid]);
        self::validate_context(\context_system::instance());
        $course = migration::require_course($courseid);
        if (!\core_component::get_component_directory('mod_publication')) {
            return [];
        }

        $fs = get_file_storage();
        $result = [];
        foreach (get_fast_modinfo($course)->get_instances_of('publication') as $cm) {
            if ($cm->deletioninprogress) {
                continue;
            }
            $publication = $DB->get_record('publication', ['id' => $cm->instance]);
            if (!$publication) {
                continue;
            }
            $files = [];
            $missing = 0;
            foreach ($DB->get_records('publication_file', ['publication' => $publication->id], 'id') as $row) {
                $file = $fs->get_file_by_id($row->fileid);
                // 別のコースや活動のファイルを指す行を返さないのは、ほかのコースのファイルを持ち出せてしまうため
                if (!$file || $file->is_directory() || (int) $file->get_contextid() !== (int) $cm->context->id
                        || $file->get_component() !== 'mod_publication' || $file->get_filearea() !== 'attachment') {
                    $missing++;
                    continue;
                }
                $files[] = [
                    'userid' => (int) $row->userid,
                    'filename' => $file->get_filename(),
                    'mimetype' => (string) $file->get_mimetype(),
                    'filesize' => (int) $file->get_filesize(),
                    'timecreated' => (int) $row->timecreated,
                    'teacherapproval' => (int) $row->teacherapproval,
                    'studentapproval' => (int) $row->studentapproval,
                    'fileurl' => \moodle_url::make_webservice_pluginfile_url(
                        $file->get_contextid(),
                        'mod_publication',
                        'attachment',
                        $file->get_itemid(),
                        $file->get_filepath(),
                        $file->get_filename()
                    )->out(false),
                ];
            }
            $result[] = [
                'cmid' => (int) $cm->id,
                'mode' => (int) $publication->mode,
                'obtainteacherapproval' => (bool) $publication->obtainteacherapproval,
                'obtainstudentapproval' => (bool) $publication->obtainstudentapproval,
                'showparticipantnames' => (bool) $publication->showparticipantnames,
                'allowsubmissionsfromdate' => (int) $publication->allowsubmissionsfromdate,
                'duedate' => (int) $publication->duedate,
                'completionupload' => (bool) $publication->completionupload,
                'allowedfiletypes' => (string) ($publication->allowedfiletypes ?? ''),
                'extensions' => self::count_extensions((int) $publication->id),
                'missing' => $missing,
                'files' => $files,
            ];
        }
        return $result;
    }

    /**
     * 学生・グループごとの期限の延長と上書きの数。
     *
     * テーブルがあるかを確かめるのは、古い版の mod_publication には上書きのテーブルがないため
     *
     * @param int $publicationid
     * @return int
     */
    private static function count_extensions(int $publicationid): int {
        global $DB;
        $count = 0;
        foreach (['publication_extduedates', 'publication_overrides'] as $table) {
            if ($DB->get_manager()->table_exists($table)) {
                $count += $DB->count_records($table, ['publication' => $publicationid]);
            }
        }
        return $count;
    }

    /**
     * @return external_multiple_structure
     */
    public static function execute_returns(): external_multiple_structure {
        return new external_multiple_structure(new external_single_structure([
            'cmid' => new external_value(PARAM_INT, 'course module id'),
            'mode' => new external_value(PARAM_INT, '0: students upload, 1: imported from an assignment'),
            'obtainteacherapproval' => new external_value(PARAM_BOOL, 'files need the teacher approval'),
            'obtainstudentapproval' => new external_value(PARAM_BOOL, 'files need the student approval'),
            'showparticipantnames' => new external_value(PARAM_BOOL, 'show who uploaded each file'),
            'allowsubmissionsfromdate' => new external_value(PARAM_INT, 'uploads open at, 0 if not set'),
            'duedate' => new external_value(PARAM_INT, 'uploads close at, 0 if not set'),
            'completionupload' => new external_value(PARAM_BOOL, 'complete when a file is uploaded'),
            'allowedfiletypes' => new external_value(PARAM_RAW, 'accepted file types, empty for any'),
            'extensions' => new external_value(PARAM_INT, 'number of extensions and overrides'),
            'missing' => new external_value(PARAM_INT, 'number of file records without a stored file'),
            'files' => new external_multiple_structure(new external_single_structure([
                'userid' => new external_value(PARAM_INT, 'owner user id, or group id for team submissions'),
                'filename' => new external_value(PARAM_RAW, 'file name'),
                'mimetype' => new external_value(PARAM_RAW, 'mime type'),
                'filesize' => new external_value(PARAM_INT, 'file size in bytes'),
                'timecreated' => new external_value(PARAM_INT, 'uploaded at'),
                'teacherapproval' => new external_value(PARAM_INT, '1: approved, 2: rejected, others: pending'),
                'studentapproval' => new external_value(PARAM_INT, '1: approved, 2: rejected, others: pending'),
                'fileurl' => new external_value(PARAM_URL, 'download url for the web service'),
            ])),
        ]));
    }
}
