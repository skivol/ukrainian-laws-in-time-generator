import * as fs from 'fs';
import * as util from 'util';
import { exec } from 'child_process';
import fetch from 'node-fetch';

const args = process.argv.slice(2)

const targetRepository = args[0];
/* Example structure
 * {
 * 	files: [{
 * 		documentId: '254к/96-вр',
 * 		lastProcessedEdition: 'ed20200101',
 * 		targetFileRelative: 'Конституція\ України/254к96-вр.md',
 * 		lastSyncDate: 'Tue, 05 Jul 2022 20:57:44 GMT'
 * 	}, ...]
 * }
 */
const syncFile = `${targetRepository}/sync.json`;
const readWriteOptions = { encoding: 'utf-8' };
const fileExists = async (file) => await fs.promises.access(file, fs.constants.F_OK).then(() => true).catch(() => false);
const syncHistory = await fileExists(syncFile) ? JSON.parse(await fs.promises.readFile(syncFile, readWriteOptions)) : { files: [] };
const file = (documentId) => syncHistory.files.find(e => e.documentId === documentId);
const resolvePathFromHistory = (documentId) => {
	const fileById = file(documentId);
	return fileById !== undefined ? fileById.targetFileRelative : null;
};
const resolveLastProcessedEdition = (documentId) => {
	const fileById = file(documentId);
	return fileById !== undefined ? fileById.lastProcessedEdition : null;
};

// https://stackoverflow.com/questions/20643470/execute-a-command-line-binary-with-node-js
const execPromise =  util.promisify(exec);
const processDocument = async (documentId, targetFileRelative, lastProcessedEdition = resolveLastProcessedEdition(documentId)) => {
	console.log("");
	console.log(`Опрацьовуємо ${documentId} документ (${targetFileRelative})...`);

	const targetFile = `${targetRepository}/${targetFileRelative}`;

	const editionSuffix = e => e ? `/${e}` : '';
	// https://data.rada.gov.ua/open/main/api/page3
	const baseUrl = e => `https://data.rada.gov.ua/laws/show/${documentId}${editionSuffix(e)}`;
	const cardUrl = e => `https://data.rada.gov.ua/laws/card/${documentId}.json${editionSuffix(e)}`;

	const cardContent = async e => {
		const response = await fetch(cardUrl(e));
		return await response.json();
	};
	const editionsToProcess = async () => {
		const { eds_dates } = await cardContent();
		const currentEditionIndex = Object.values(eds_dates).indexOf(0);
		const editionsUpToNow = Object.keys(eds_dates).slice(0, currentEditionIndex + 1).map(k => `ed${k}`);

		// filter out irrelevant editions if needed
		const lastProcessedEditionIndex = lastProcessedEdition ? editionsUpToNow.findIndex(
			e => e.includes(lastProcessedEdition)
		) : -1;
		if (lastProcessedEdition && lastProcessedEditionIndex === -1) {
			throw new Error(`${lastProcessedEdition} редакція не знайдена серед редакцій ${documentId} документа`);
		}
		if (lastProcessedEditionIndex === editionsUpToNow.length - 1) {
			throw new Error(`${lastProcessedEdition} редакція є останньою для ${documentId} документа`);
		}
		const thereIsSomethingToSkip = lastProcessedEditionIndex !== -1;
		const editionUrl = e => baseUrl(e);
		const relevantEditions = (thereIsSomethingToSkip ? editionsUpToNow.slice(lastProcessedEditionIndex + 1) : editionsUpToNow);
		return relevantEditions;
	};

	const writeFile = async (targetFile, content) => {
		await fs.promises.writeFile(targetFile, content, readWriteOptions);
	};

	const downloadConvertAndUpdateDocument = async (e) => {
		const editionUrl = baseUrl(e);
		console.log(`Завантажуємо та перетворюємо ${editionUrl} документ`);

		// download
		const response = await fetch(editionUrl);
		const content = await response.text();
		const contentFile = "/tmp/temp.html";
		await writeFile(contentFile, content);

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

		// convert using pandoc
		const convertCommand = `pandoc -f html -t markdown --wrap=preserve ${contentFile} > "${targetFile}"`;
		const { stdout, stderr } = await execPromise(convertCommand);
		console.log(stdout);
		console.log(stderr);
	};

	const commitMessageFile = "/tmp/commitMessage.txt";
	const prepareCommitMessage = async (edition) => {
		// console.log(`Готуємо повідомлення для git в файлі ${commitMessageFile}`);
		const { nazva, nreg, datred, pidstava } = await cardContent(edition);
		const date = d => `${d.slice(6)}.${d.slice(4,6)}.${d.slice(0,4)}`; // DD.MM.YYYY
		const idEditionAndBasisForChange = `Документ ${nreg}, Редакція від ${date(datred.toString())}${pidstava && pidstava.length ? `, підстава - ${pidstava}` : ''}`;
		const targetFileExists = await fileExists(targetFile);
		const action = targetFileExists ? `Оновлює` : `Додає`;
		const message = `${action} "${nazva}" (${idEditionAndBasisForChange})

Джерело: ${baseUrl(edition)}
Перетворено в markdown за допомогою pandoc.
`;
		await writeFile(commitMessageFile, message);
	};

	const performCommit = async () => {
		console.log("Записуємо зміни в git");
		// commit of specifically "${targetFileRelative}" - did not match any files (maybe due to initially untracked folder structure)
		const addFilesCommand = `git -C ${targetRepository} add -A`
		const addFilesResult = await execPromise(addFilesCommand);

		const commitCommand = `git -C ${targetRepository} commit -F ${commitMessageFile}`;
		const { stdout, stderr } = await execPromise(commitCommand);
		console.log(stdout);
		console.log(stderr);
	};

	const trackDocumentProcessed = async (documentId, lastProcessedEdition, targetFileRelative) => {
		const existing = syncHistory.files.find(e => e.documentId === documentId);
		const lastSyncDate = (new Date()).toUTCString();

		if (existing === undefined) {
			syncHistory.files.push({
				documentId, lastProcessedEdition, targetFileRelative, lastSyncDate
			});
		} else {
			existing.lastProcessedEdition = lastProcessedEdition;
			existing.lastSyncDate = lastSyncDate;
		}

		await writeFile(syncFile, JSON.stringify(syncHistory, null, 2));
	};

	const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

	const handleEdition = async (edition, i, total) => { // "edition" is like "ed20150304"
		console.log("");
		console.log(`Опрацьовуємо документ ${documentId}, видання №${i + 1} з ${total} (нумерація відносна) (${edition})`);

		await prepareCommitMessage(edition); // if would go after convertion, "action" variable would need to be calculated beforehand
		await downloadConvertAndUpdateDocument(edition);
		await trackDocumentProcessed(documentId, edition, targetFileRelative);
		await performCommit();

		// conversion itself takes 2-5 seconds so there's anyway delay
		// 5 to 25 seconds additional delay
		const randomSeconds = 5 + Math.random()*20;
		console.log(`Відпочиваємо ${randomSeconds} секунд (щоб не перевантажувати запитами data.rada.gov.ua)`);
		await delay(1000 * randomSeconds);
	};

	if (lastProcessedEdition && lastProcessedEdition.length > 0) {
		console.log(`Починаємо з ${lastProcessedEdition} редакції`);
	}

	const relevantEditions = await editionsToProcess();

	// "array.forEach" doesn't wait for async completion, thus would not properly work
	// relevantEditions.forEach(handleEdition);

	for (let i = 0; i < relevantEditions.length; i++) {
		await handleEdition(relevantEditions[i], i, relevantEditions.length);
	}
};

const documentIdToProcess = args[1];
if (documentIdToProcess) {
	const targetFileRelative = args[2] || resolvePathFromHistory(documentIdToProcess); // command line argument could be empty if document is already tracked in "sync.json" file
	await processDocument(documentIdToProcess, targetFileRelative);
} else { // sync (that is, check if new editions available and process them in this case) all documents that are tracked in repository
	for (const syncFile of syncHistory.files) {
		const { documentId, targetFileRelative, lastProcessedEdition } = syncFile;
		try {
			await processDocument(documentId, targetFileRelative, lastProcessedEdition);
		} catch (e) {
			console.log(e.message);
		}
	}
}

