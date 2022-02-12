import * as fs from 'fs';
import * as util from 'util';
import { exec } from 'child_process';
import TurndownService from 'turndown';
import fetch from 'node-fetch';
import cheerio from 'cheerio';

const args = process.argv.slice(2)

const targetRepository = args[0];
const documentId = args[1]; // for example, "80731-10"
const targetFileRelative = args[2];
const targetFile = `${targetRepository}/${targetFileRelative}`;
const lastProcessedEdition = args[3]; // for example, "ed20021105" or could be empty to start from the very beginning

const baseUrl = "https://zakon.rada.gov.ua/laws/show";
const documentFrame = (url) => `${url}.frame`;
const documentUrl = () => `${baseUrl}/${documentId}`;

const previousEditionColor = 'color:#666666';
const currentEditionColor = 'color:#0c628d';
const futureEditionColor = 'color:#CC0000';
const editionSelector = (editionColor) => `span#edition select option[style*="${editionColor}"]`;

const cheerioDocument = async (documentContentUrl) => {
	const response = await fetch(documentContentUrl);
	const documentContent = await response.text();
	return cheerio.load(documentContent);
};

const documentName = ($) => $('h1').text();
const documentIdEditionAndBasisForChange = ($) => {
	const subtitle = $($('div.box.alert.text-center div div')[0])
		// retrieve concatenated text
		.text()
		// remove newline
		.replace(/[\n\r]+/g, ' ')
		// remove irrelevant (in long-term) information
		.replace(/( чинний,)? (поточна|попередня) редакція —/g, '');
	return subtitle;
};

const editionsToProcess = ($) => {
	const previousEditions = $(editionSelector(previousEditionColor)).toArray();
	const currentEdition = ($(editionSelector(currentEditionColor)).toArray())[0];
	const editionsUpToNow = [...previousEditions, currentEdition];
	// filter out irrelevant editions if needed
	const lastProcessedEditionIndex = lastProcessedEdition ? editionsUpToNow.findIndex(
		e => e.attribs.value.includes(lastProcessedEdition)
	) : -1;
	if (lastProcessedEdition && lastProcessedEditionIndex === -1) {
		throw new Error(`${lastProcessedEdition} редакція не знайдена серед редакцій ${documentId} документа`);
	}
	if (lastProcessedEditionIndex === editionsUpToNow.length - 1) {
		throw new Error(`${lastProcessedEdition} редакція є останньою для ${documentId} документа`);
	}
	const thereIsSomethingToSkip = lastProcessedEditionIndex !== -1;
	const relevantEditionsUrls = (thereIsSomethingToSkip ? editionsUpToNow.slice(lastProcessedEditionIndex + 1) : editionsUpToNow).map(e => e.attribs.value);
	return relevantEditionsUrls;
};

const readWriteOptions = { encoding: 'utf-8' };
const writeFile = async (targetFile, content) => {
	await fs.promises.writeFile(targetFile, content, readWriteOptions);
};

const downloadConvertAndUpdateDocument = async (e) => {
	console.log(`Завантажуємо та перетворюємо ${e} документ`);

	// download
	const $ = await cheerioDocument(documentFrame(e));
	// extract
	const contentSelector = 'div#article';
	const content = $.html($(contentSelector)); // content of whole "content" tag (https://stackoverflow.com/a/43365200)
	if (!content || content.length < 100) {
		console.log(`Вміст документа: "${content}"`);
		throw new Error(`Вміст не знайдено в '${contentSelector}' селекторі ${e} документа`);
	}
	// convert
	const md = new TurndownService().turndown(content);

	// Ensure target folder exists
	const targetFilePathParts = targetFileRelative.split("/");
	const isInDir = targetFilePathParts.length > 1;
	if (isInDir) {
		const targetDirRelative = targetFilePathParts.slice(0, -1);
		const targetDir = `${targetRepository}/${targetDirRelative.join("/")}`;
		const targetDirExists = await fileExists(targetDir);
		if (!targetDirExists) {
			console.log(`Папка "${targetDir}" не існує! Створюємо!`);
			await fs.promises.mkdir(targetDir, { recursive: true });
		}
	}

	// write
	await writeFile(targetFile, md);
};

const fileExists = async (file) => await fs.promises.access(file, fs.constants.F_OK).then(() => true).catch(() => false);
const commitMessageFile = "/tmp/commitMessage.txt";
const prepareCommitMessage = async (e) => {
	// console.log(`Готуємо повідомлення для git в файлі ${commitMessageFile}`);

	const $ = await cheerioDocument(e);
	const name = documentName($);
	const idEditionAndBasisForChange = documentIdEditionAndBasisForChange($);
	const targetFileExists = await fileExists(targetFile);
	const action = targetFileExists ? `Оновлює` : `Додає`;
	const message = `${action} "${name}" (${idEditionAndBasisForChange})

Джерело: ${e}
`;
	await writeFile(commitMessageFile, message);
};

const performCommit = async () => {
	console.log("Записуємо зміни в git");
	// https://stackoverflow.com/questions/20643470/execute-a-command-line-binary-with-node-js
	const execPromise =  util.promisify(exec);
	// commit of specifically "${targetFileRelative}" - did not match any files (maybe due to initially untracked folder structure)
	const addFilesCommand = `git -C ${targetRepository} add -A`
	const addFilesResult = await execPromise(addFilesCommand);

	const commitCommand = `git -C ${targetRepository} commit -F ${commitMessageFile}`;
	const { stdout, stderr } = await execPromise(commitCommand);
	console.log(stdout);
	console.log(stderr);
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const handleEdition = async (editionUrl, i, total) => { // "editionUrl" is like "https://zakon.rada.gov.ua/laws/show/80731-10/ed20150304"
	console.log("");
	console.log(`Опрацьовуємо документ ${documentId}, видання №${i + 1} з ${total} (нумерація відносна) (${editionUrl})`);

	await prepareCommitMessage(editionUrl); // if would go after convertion, "action" variable would need to be calculated beforehand
	await downloadConvertAndUpdateDocument(editionUrl);
	await performCommit();

	// conversion itself takes 2-5 seconds so there's anyway delay
	// console.log("Відпочиваємо трохи (щоб не перевантажувати запитами сайт zakon.rada.gov.ua)");
	// await delay(1000);
};

if (lastProcessedEdition && lastProcessedEdition.length > 0) {
	console.log(`Починаємо перетворення з ${lastProcessedEdition} редакції`);
}

const $content = await cheerioDocument(documentFrame(documentUrl()));
const editionUrls = editionsToProcess($content);

// "array.forEach" doesn't wait for async completion, thus would not properly work
// editionUrls.forEach(handleEdition);

for (let i = 0; i < editionUrls.length; i++) {
	await handleEdition(editionUrls[i], i, editionUrls.length);
}

