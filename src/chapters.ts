/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Represents a single chapter of a media file: a named section of the timeline, such as "Intro" or
 * "Credits". Chapters are descriptive metadata attached to the file as a whole, not to any individual track.
 *
 * - For MP4/QuickTime files, chapters are stored as a Nero-style chapter list in the user data (`'udta'`) atom.
 * - For WebM/Matroska files, chapters are stored as chapter atoms within the Chapters element.
 * - For all other formats, chapters are currently not supported.
 *
 * @group Chapters
 * @public
 */
export type Chapter = {
	/** The timestamp at which the chapter starts, in seconds. */
	start: number;
	/**
	 * The timestamp at which the chapter ends, in seconds.
	 *
	 * When writing, this field can be left undefined, in which case the chapter extends until the start of the
	 * next chapter, or until the end of the media file if it is the last chapter. When reading, this field is
	 * always set unless the end cannot be determined from the file.
	 */
	end?: number;
	/** The name (title) of the chapter. */
	name: string;
};

export const validateChapters = (chapters: Chapter[]) => {
	if (!Array.isArray(chapters)) {
		throw new TypeError('chapters must be an array.');
	}

	let lastStart = -Infinity;

	for (const chapter of chapters) {
		if (!chapter || typeof chapter !== 'object') {
			throw new TypeError('Each chapter must be an object.');
		}
		if (typeof chapter.start !== 'number' || !Number.isFinite(chapter.start) || chapter.start < 0) {
			throw new TypeError('Each chapter.start must be a non-negative, finite number.');
		}
		if (
			chapter.end !== undefined
			&& (typeof chapter.end !== 'number' || !Number.isFinite(chapter.end) || chapter.end < chapter.start)
		) {
			throw new TypeError(
				'Each chapter.end, when provided, must be a finite number greater than or equal to chapter.start.',
			);
		}
		if (typeof chapter.name !== 'string') {
			throw new TypeError('Each chapter.name must be a string.');
		}
		if (chapter.start <= lastStart) {
			throw new TypeError('Chapters must be sorted by start time, with strictly increasing start times.');
		}

		lastStart = chapter.start;
	}
};
