import { expect, test } from 'vitest';
import { Output } from '../../src/output.js';
import {
	MkvOutputFormat,
	Mp4OutputFormat,
	OutputFormat,
	WebMOutputFormat,
} from '../../src/output-format.js';
import { BufferTarget } from '../../src/target.js';
import { EncodedVideoPacketSource } from '../../src/media-source.js';
import { EncodedPacket } from '../../src/packet.js';
import { Input } from '../../src/input.js';
import { BufferSource } from '../../src/source.js';
import { ALL_FORMATS } from '../../src/input-format.js';
import { EncodedPacketSink } from '../../src/media-sink.js';
import { MetadataTags } from '../../src/metadata.js';
import { Chapter } from '../../src/chapters.js';
import { assert } from '../../src/misc.js';

// 片名是夜场，作者是阿禾，专辑是第二场，曲目是 3，一共 12 首，每分钟 96 拍，类型是纪录，备注是审片，
// 日期是 2024-03-15
const metadataTags: MetadataTags = {
	title: '夜场',
	artist: '阿禾',
	album: '第二场',
	trackNumber: 3,
	tracksTotal: 12,
	beatsPerMinute: 96,
	genre: '纪录',
	comment: '审片',
	date: new Date('2024-03-15'),
};

// 画面 8 个包，从 0 秒起，每个包 0.5 秒，第一字节依次是 0、1、2、3、4、5、6、7。0 秒那个是关键包，
// 后面七个是普通包。结束时间是 4。
const PACKET_COUNT = 8;
const PACKET_DURATION = 0.5;

const createFile = async (format: OutputFormat, chapters: Chapter[]) => {
	const output = new Output({
		format,
		target: new BufferTarget(),
	});

	output.setMetadataTags(metadataTags);
	output.setChapters(chapters);

	const source = new EncodedVideoPacketSource('vp8');
	output.addVideoTrack(source);

	await output.start();

	const meta = { decoderConfig: { codec: 'vp8', codedWidth: 640, codedHeight: 360 } };

	for (let i = 0; i < PACKET_COUNT; i++) {
		const data = new Uint8Array(16);
		data[0] = i;

		await source.add(
			new EncodedPacket(data, i === 0 ? 'key' : 'delta', i * PACKET_DURATION, PACKET_DURATION),
			i === 0 ? meta : undefined,
		);
	}

	source.close();
	await output.finalize();

	return output.target.buffer!;
};

const checkMetadataAndPackets = async (input: Input) => {
	// 标了段之后，这些字和数字还要能读回来
	const tags = await input.getMetadataTags();
	expect(tags.title).toBe('夜场');
	expect(tags.artist).toBe('阿禾');
	expect(tags.album).toBe('第二场');
	expect(tags.trackNumber).toBe(3);
	expect(tags.tracksTotal).toBe(12);
	expect(tags.beatsPerMinute).toBe(96);
	expect(tags.genre).toBe('纪录');
	expect(tags.comment).toBe('审片');
	assert(tags.date);
	expect(tags.date.toISOString().slice(0, 10)).toBe('2024-03-15');

	// 上面那些画面包的时间、字节、关键还是普通，也不变
	const track = await input.getPrimaryVideoTrack();
	assert(track);

	const sink = new EncodedPacketSink(track);

	const packet0 = await sink.getPacket(0);
	assert(packet0);
	expect(packet0.timestamp).toBe(0);
	expect(packet0.data[0]).toBe(0);
	expect(packet0.type).toBe('key');

	const packet06 = await sink.getPacket(0.6);
	assert(packet06);
	expect(packet06.timestamp).toBe(0.5);
	expect(packet06.data[0]).toBe(1);
	expect(packet06.type).toBe('delta');

	const packet1 = await sink.getPacket(1);
	assert(packet1);
	expect(packet1.timestamp).toBe(1);
	expect(packet1.data[0]).toBe(2);
	expect(packet1.type).toBe('delta');

	const packet39 = await sink.getPacket(3.9);
	assert(packet39);
	expect(packet39.timestamp).toBe(3.5);
	expect(packet39.data[0]).toBe(7);
	expect(packet39.type).toBe('delta');

	// All eight packets, in order
	const packets: EncodedPacket[] = [];
	for await (const packet of sink.packets()) {
		packets.push(packet);
	}

	expect(packets).toHaveLength(PACKET_COUNT);
	for (let i = 0; i < PACKET_COUNT; i++) {
		expect(packets[i]!.timestamp).toBe(i * PACKET_DURATION);
		expect(packets[i]!.duration).toBe(PACKET_DURATION);
		expect(packets[i]!.data[0]).toBe(i);
		expect(packets[i]!.type).toBe(i === 0 ? 'key' : 'delta');
	}

	// 结束时间是 4
	expect(await input.computeDuration()).toBe(4);
};

const checkChapters = async (input: Input, expectedChapters: Chapter[]) => {
	const chapters = await input.getChapters();
	expect(chapters).toEqual(expectedChapters);
};

const chapter1 = [
	{ start: 0, end: 1.5, name: '开场' },
	{ start: 1.5, end: 3, name: '对白' },
	{ start: 3, end: 4, name: '片尾' },
];

const checkFirstFileQueries = async (input: Input) => {
	// 问 0 秒，段名是开场，这一段从 0 秒开始
	expect(await input.getChapterAt(0)).toEqual(chapter1[0]);
	// 问 1.4 秒，还是开场
	expect(await input.getChapterAt(1.4)).toEqual(chapter1[0]);
	// 问 1.5 秒，段名换成对白，这一段从 1.5 秒开始
	expect(await input.getChapterAt(1.5)).toEqual(chapter1[1]);
	// 问 2.9 秒，还是对白
	expect(await input.getChapterAt(2.9)).toEqual(chapter1[1]);
	// 问 3 秒，段名换成片尾，这一段从 3 秒开始
	expect(await input.getChapterAt(3)).toEqual(chapter1[2]);
	// 问 3.9 秒，还是片尾
	expect(await input.getChapterAt(3.9)).toEqual(chapter1[2]);
};

const chapter2 = [
	{ start: 0.5, end: 2, name: '暖场' },
	{ start: 2, end: 4, name: '正片' },
];

const checkSecondFileQueries = async (input: Input) => {
	// 问 0.2 秒，没有落在任何一段里
	expect(await input.getChapterAt(0.2)).toBeNull();
	// 问 0.5 秒，段名是暖场，这一段从 0.5 秒开始
	expect(await input.getChapterAt(0.5)).toEqual(chapter2[0]);
	// 问 1.9 秒，还是暖场
	expect(await input.getChapterAt(1.9)).toEqual(chapter2[0]);
	// 问 2 秒，段名换成正片，这一段从 2 秒开始
	expect(await input.getChapterAt(2)).toEqual(chapter2[1]);
	// 问 3.5 秒，还是正片
	expect(await input.getChapterAt(3.5)).toEqual(chapter2[1]);
};

const chapterList1: Chapter[] = [
	{ start: 0, name: '开场' },
	{ start: 1.5, name: '对白' },
	{ start: 3, name: '片尾' },
];

const chapterList2: Chapter[] = [
	{ start: 0.5, name: '暖场' },
	{ start: 2, name: '正片' },
];

test('Chapters, metadata and packets round-trip, MP4', async () => {
	const buffer = await createFile(new Mp4OutputFormat(), chapterList1);

	using input = new Input({
		source: new BufferSource(buffer),
		formats: ALL_FORMATS,
	});

	await checkMetadataAndPackets(input);
	await checkChapters(input, chapter1);
	await checkFirstFileQueries(input);
});

test('Chapters, metadata and packets round-trip, Matroska', async () => {
	const buffer = await createFile(new MkvOutputFormat(), chapterList1);

	using input = new Input({
		source: new BufferSource(buffer),
		formats: ALL_FORMATS,
	});

	await checkMetadataAndPackets(input);
	await checkChapters(input, chapter1);
	await checkFirstFileQueries(input);
});

test('Chapters, metadata and packets round-trip, WebM', async () => {
	const buffer = await createFile(new WebMOutputFormat(), chapterList1);

	using input = new Input({
		source: new BufferSource(buffer),
		formats: ALL_FORMATS,
	});

	await checkMetadataAndPackets(input);
	await checkChapters(input, chapter1);
	await checkFirstFileQueries(input);
});

test('Chapters not starting at zero, MP4', async () => {
	const buffer = await createFile(new Mp4OutputFormat(), chapterList2);

	using input = new Input({
		source: new BufferSource(buffer),
		formats: ALL_FORMATS,
	});

	await checkMetadataAndPackets(input);
	await checkChapters(input, chapter2);
	await checkSecondFileQueries(input);
});

test('Chapters not starting at zero, Matroska', async () => {
	const buffer = await createFile(new MkvOutputFormat(), chapterList2);

	using input = new Input({
		source: new BufferSource(buffer),
		formats: ALL_FORMATS,
	});

	await checkMetadataAndPackets(input);
	await checkChapters(input, chapter2);
	await checkSecondFileQueries(input);
});

test('Chapters not starting at zero, WebM', async () => {
	const buffer = await createFile(new WebMOutputFormat(), chapterList2);

	using input = new Input({
		source: new BufferSource(buffer),
		formats: ALL_FORMATS,
	});

	await checkMetadataAndPackets(input);
	await checkChapters(input, chapter2);
	await checkSecondFileQueries(input);
});

test('No chapters set means no chapters read, MP4 and Matroska', async () => {
	for (const format of [new Mp4OutputFormat(), new MkvOutputFormat()]) {
		const output = new Output({
			format,
			target: new BufferTarget(),
		});

		const source = new EncodedVideoPacketSource('vp8');
		output.addVideoTrack(source);

		await output.start();
		await source.add(
			new EncodedPacket(new Uint8Array(16), 'key', 0, 0.5),
			{ decoderConfig: { codec: 'vp8', codedWidth: 640, codedHeight: 360 } },
		);
		source.close();
		await output.finalize();

		using input = new Input({
			source: new BufferSource(output.target.buffer!),
			formats: ALL_FORMATS,
		});

		expect(await input.getChapters()).toEqual([]);
		expect(await input.getChapterAt(0)).toBeNull();
	}
});

test('setChapters validates its input', async () => {
	const output = new Output({
		format: new Mp4OutputFormat(),
		target: new BufferTarget(),
	});

	expect(() => output.setChapters(null!)).toThrow(TypeError);
	expect(() => output.setChapters([{ start: -1, name: 'a' }])).toThrow(TypeError);
	expect(() => output.setChapters([{ start: 0, name: 'a' }, { start: 0, name: 'b' }])).toThrow(TypeError);
	expect(() => output.setChapters([{ start: 2, name: 'a' }, { start: 1, name: 'b' }])).toThrow(TypeError);
	expect(() => output.setChapters([{ start: 0, end: -1, name: 'a' }])).toThrow(TypeError);
	expect(() => output.setChapters([{ start: 0 } as unknown as Chapter])).toThrow(TypeError);
});
