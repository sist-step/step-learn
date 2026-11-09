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

use availability_completion\condition as completion_condition;
use availability_date\condition as date_condition;
use core_availability\tree;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;

/**
 * アクセス制限のうち、STEP Learn の画面で扱える形（日付と活動の完了をすべて満たす）との変換。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class restrictions {
    /**
     * 制限の JSON を STEP Learn の画面で扱える形にする。扱えない条件を含むときは null。
     *
     * @param string|null $json course_modules / course_sections の availability
     * @return array{from: int, until: int, after: int[], hideunmet: bool}|null
     */
    public static function parse(?string $json): ?array {
        $result = ['from' => 0, 'until' => 0, 'after' => [], 'hideunmet' => false];
        if ($json === null || $json === '') {
            return $result;
        }
        $tree = json_decode($json);
        if (!is_object($tree) || ($tree->op ?? '') !== tree::OP_AND || !is_array($tree->c ?? null)) {
            return null;
        }
        $showc = array_map('boolval', is_array($tree->showc ?? null) ? $tree->showc : []);
        // 条件ごとに表示を変えたものを扱わないのは、画面では制限全体で 1 つの表示の設定にしているため
        if (count(array_unique($showc)) > 1) {
            return null;
        }
        $result['hideunmet'] = $showc === [false];
        foreach ($tree->c as $c) {
            $type = $c->type ?? '';
            $direction = $c->d ?? '';
            if ($type === 'date' && $direction === date_condition::DIRECTION_FROM && !$result['from']) {
                $result['from'] = (int) $c->t;
            } else if ($type === 'date' && $direction === date_condition::DIRECTION_UNTIL && !$result['until']) {
                $result['until'] = (int) $c->t;
            } else if (
                $type === 'completion'
                && (int) ($c->e ?? -1) === COMPLETION_COMPLETE
                && !in_array((int) $c->cm, $result['after'], true)
            ) {
                $result['after'][] = (int) $c->cm;
            } else {
                return null;
            }
        }
        return $result;
    }

    /**
     * STEP Learn の画面の値から制限の JSON を作る。条件がなければ null（制限なし）。
     *
     * @param int $from この日時から（0 は指定なし）
     * @param int $until この日時まで（0 は指定なし）
     * @param int[] $after 完了が条件の活動（-1 は直前の活動）
     * @param bool $hideunmet 条件を満たしていない学生には活動ごと見せない
     * @return string|null
     */
    public static function build(int $from, int $until, array $after, bool $hideunmet): ?string {
        $conditions = [];
        if ($from) {
            $conditions[] = date_condition::get_json(date_condition::DIRECTION_FROM, $from);
        }
        if ($until) {
            $conditions[] = date_condition::get_json(date_condition::DIRECTION_UNTIL, $until);
        }
        foreach ($after as $cmid) {
            $conditions[] = completion_condition::get_json($cmid, COMPLETION_COMPLETE);
        }
        return $conditions ? json_encode(tree::get_root_json($conditions, tree::OP_AND, !$hideunmet)) : null;
    }

    /**
     * 教師向けの、すべての条件を書いた説明（HTML）。
     *
     * @param \core_availability\info $info
     * @param \stdClass $course
     * @return string
     */
    public static function describe(\core_availability\info $info, \stdClass $course): string {
        $full = $info->get_full_information();
        return $full ? \core_availability\info::format_info($full, $course) : '';
    }

    /**
     * @param int $sectionid
     * @param int $cmid
     * @param string|null $json
     * @param string $info
     * @return array
     */
    public static function export(int $sectionid, int $cmid, ?string $json, string $info): array {
        $parsed = self::parse($json);
        return [
            'sectionid' => $sectionid,
            'cmid' => $cmid,
            'info' => $info,
            'editable' => $parsed !== null,
        ] + ($parsed ?? ['from' => 0, 'until' => 0, 'after' => [], 'hideunmet' => false]);
    }

    /**
     * @return external_single_structure
     */
    public static function structure(): external_single_structure {
        return new external_single_structure([
            'sectionid' => new external_value(PARAM_INT, 'section id, or 0 for a course module'),
            'cmid' => new external_value(PARAM_INT, 'course module id, or 0 for a section'),
            'info' => new external_value(PARAM_RAW, 'all conditions as shown to teachers (HTML)'),
            'editable' => new external_value(PARAM_BOOL, 'only date and activity completion conditions that must all be met'),
            'from' => new external_value(PARAM_INT, 'available from (0 when not set or not editable)'),
            'until' => new external_value(PARAM_INT, 'available until (0 when not set or not editable)'),
            'after' => new external_multiple_structure(
                new external_value(PARAM_INT, 'course module id, or -1 for the previous activity'),
                'activities that must be marked complete'
            ),
            'hideunmet' => new external_value(PARAM_BOOL, 'hidden entirely from users who do not meet the conditions'),
        ]);
    }
}
