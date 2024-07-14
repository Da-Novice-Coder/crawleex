import { PlaywrightCrawler, Dataset } from 'crawlee';
import { connectDB, saveMovie } from './database.js';
import logger from './logger.js';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import fs from 'fs-extra';
import path from 'path';

dotenv.config();

const configDir = path.join(__dirname, 'config');
const proxyFilePath = path.join(configDir, 'proxies.txt');
const userAgentFilePath = path.join(configDir, 'userAgents.txt');
const queueFilePath = path.join(configDir, 'queue.json');
const crawledFilePath = path.join(configDir, 'crawled.json');
const moviesFilePath = path.join(configDir, 'movies.json');


const baseUrl = 'https://www.xvideos.com';


const loadProxies = async () => (await readFile(proxyFilePath, 'utf8')).split('\n').filter(Boolean);
const loadUserAgents = async () => (await readFile(userAgentFilePath, 'utf8')).split('\n').filter(Boolean);

const proxies = await loadProxies();
const userAgents = await loadUserAgents();
let crawled = new Set();
let movies = [];

const getRandomProxy = () => proxies[Math.floor(Math.random() * proxies.length)];
const getRandomUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)];

const saveState = async (queue) => {
    await writeFile(queueFilePath, JSON.stringify(queue.map(req => req.url)));
    await writeFile(crawledFilePath, JSON.stringify(Array.from(crawled)));
};

const loadState = async (requestQueue) => {
    if (existsSync(queueFilePath)) {
        try {
            const queueData = await readFile(queueFilePath, 'utf8');
            const queueItems = JSON.parse(queueData);
            for (const item of queueItems) {
                await requestQueue.addRequest({ url: item });
            }
        } catch (error) {
            logger.warn(`Failed to load queue from file: ${error.message}`);
        }
    }

    if (existsSync(crawledFilePath)) {
        try {
            const crawledData = await readFile(crawledFilePath, 'utf8');
            crawled = new Set(JSON.parse(crawledData));
        } catch (error) {
            logger.warn(`Failed to load crawled from file: ${error.message}`);
        }
    }
};

const handleMoviePage = async (page, url) => {
    logger.info(`Scraping movie: ${url}`);
    
    const movie = await page.evaluate(() => {
        const data = {};
        const div = document.querySelector('#video-player-bg');
        if (!div) return null;
        const text = div.children[5]?.textContent || '';

        const regexMap = {
            title: /html5player\.setVideoTitle\('([^']+)'\);/,
            videoUrlLow: /html5player\.setVideoUrlLow\('([^']+)'\);/,
            videoUrlHigh: /html5player\.setVideoUrlHigh\('([^']+)'\);/,
            videoUrlHls: /html5player\.setVideoHLS\('([^']+)'\);/,
            thumbnailUrl: /html5player\.setThumbUrl169\('([^']+)'\);/,
            uploaderName: /html5player\.setUploaderName\('([^']+)'\);/,
        };

        for (const key in regexMap) {
            const match = text.match(regexMap[key]);
            data[key] = match ? match[1] : null;
        }

        data.videoQuality = document.querySelector('.video-hd-mark')?.textContent || '';
        data.pornstars = Array.from(document.querySelectorAll('.video-metadata > ul li.model')).map((li) => li.querySelector('a').href.split('/')[4]);
        data.tags = Array.from(document.querySelectorAll('.is-keyword')).map((el) => el.innerText);
        data.duration = document.querySelector('.duration')?.textContent || '';
        data.views = document.querySelector('#v-views .mobile-hide')?.textContent || '';
        data.comments = document.querySelector('.comments .badge')?.textContent || '';

        return data;
    });

    if (movie) {
        await saveMovie(movie);
        await Dataset.pushData(movie);
        movies.push(movie);
        logger.info(`Scraped movie: ${movie.title}`);
        if (movies.length % 10 === 0) {
            await writeFile(moviesFilePath, JSON.stringify(movies, null, 2));
            logger.info(`Saved ${movies.length} movies`);
        }
    }
};

const handleListingPage = async (page, enqueueLinks) => {
    logger.info(`Scraping listing page: ${page.url()}`);

    await enqueueLinks({
        selector: '.thumb-block .thumb a',
        label: 'DETAIL',
    });

    await enqueueLinks({
        selector: '.pagination ul .next-page',
        label: 'LISTING',
        baseUrl: 'https://www.xvideos.com',
    });
};

const crawler = new PlaywrightCrawler({
    // proxyUrl: getRandomProxy(),
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 60,
    async requestHandler({ request, page, enqueueLinks }) {
        const url = request.url;
        await page.authenticate({ username: proxyUsername, password: proxyPassword });
        // await page.setUserAgent(getRandomUserAgent());
        await page.route('**/*', (route) => {
            const request = route.request();
            if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
                route.abort();
            } else {
                route.continue();
            }
        });

        if (url.includes('/video')) {
            await handleMoviePage(page, url);
        } else {
            await handleListingPage(page, enqueueLinks);
        }
        crawled.add(url);
        await saveState(requestQueue);
    },
    failedRequestHandler({ request, error }) {
        logger.error(`Request ${request.url} failed with error: ${error.message}`);
    },
});

const main = async () => {
    await connectDB();

    const requestQueue = await crawler.createRequestQueue();
    await loadState(requestQueue);

    if (await requestQueue.isEmpty()) {
        await requestQueue.addRequest({ url: baseUrl });
    }

    await crawler.run(requestQueue);
    logger.info('Crawler finished.');
};

main().catch(console.error);
