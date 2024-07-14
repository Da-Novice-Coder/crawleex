import { PlaywrightCrawler, Dataset, ProxyConfiguration, RequestQueue } from 'crawlee';
import { connectDB, saveMovie } from './database.js';
import logger from './logger.js';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configDir = path.join(__dirname, 'config');
const proxyFilePath = path.join(configDir, 'proxies.txt');
const userAgentFilePath = path.join(configDir, 'userAgents.txt');
const queueFilePath = path.join(configDir, 'queue.json');
const crawledFilePath = path.join(configDir, 'crawled.json');
const moviesFilePath = path.join(configDir, 'movies.json');

const baseUrl = 'https://www.xvideos.com';

const loadProxies = async () => (await readFile(proxyFilePath, 'utf8')).split('\n').map(proxy => {
    const [host, port, username, password] = proxy.replace('\r', '').split(':');
    return `http://${username}:${password}@${host}:${port}`;
});
const loadUserAgents = async () => (await readFile(userAgentFilePath, 'utf8')).split('\n').filter(Boolean);

const proxies = await loadProxies();
const userAgents = await loadUserAgents();
let crawled = new Set();
let movies = [];

const getRandomProxy = () => proxies[Math.floor(Math.random() * proxies.length)];
const getRandomUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)];

const saveState = async (queue) => {
    try {
        await writeFile(queueFilePath, JSON.stringify(queue.map(req => req.url)));
        await writeFile(crawledFilePath, JSON.stringify(Array.from(crawled)));
    } catch (error) {
        logger.error(`Failed to save state: ${error.message}`);
    }
};

const loadState = async (requestQueue) => {
    try {
        if (existsSync(queueFilePath)) {
            const queueData = await readFile(queueFilePath, 'utf8');
            const queueItems = JSON.parse(queueData);
            for (const item of queueItems) {
                await requestQueue.addRequest({ url: item });
            }
        }

        if (existsSync(crawledFilePath)) {
            const crawledData = await readFile(crawledFilePath, 'utf8');
            crawled = new Set(JSON.parse(crawledData));
        }
    } catch (error) {
        logger.warn(`Failed to load state: ${error.message}`);
    }
};

const handleMoviePage = async (page, url) => {
    logger.info(`Scraping movie: ${url}`);
    try {
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
    } catch (error) {
        logger.error(`Failed to scrape movie: ${error.message}`);
    }
};

const handleListingPage = async (page, enqueueLinks) => {
    logger.info(`Scraping listing page: ${page.url()}`);
    try {
        await enqueueLinks({
            selector: '.thumb-block .thumb a',
            label: 'DETAIL',
        });

        await enqueueLinks({
            selector: '.pagination ul .next-page',
            label: 'LISTING',
            baseUrl: 'https://www.xvideos.com',
        });
    } catch (error) {
        logger.error(`Failed to scrape listing page: ${error.message}`);
    }
};

const proxyConfiguration = new ProxyConfiguration({
    proxyUrls: proxies,
});

const crawler = new PlaywrightCrawler({
    // proxyConfiguration,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 60,
    async requestHandler({ request, page, enqueueLinks, requestQueue }) {
        const url = request.url;
        try {
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
        } catch (error) {
            logger.error(`Request ${request.url} failed: ${error.message}`);
        }
    },
    failedRequestHandler({ request, error }) {
        logger.error(`Request ${request.url} failed with error: ${error.message}`);
    },
});

const main = async () => {
    try {
        await connectDB();

        const requestQueue = await RequestQueue.open();
        await requestQueue.addRequest({ url: baseUrl });

        await loadState(requestQueue);
        console.log(requestQueue);

        await crawler.run([baseUrl]);
        logger.info('Crawler finished.');
    } catch (error) {
        logger.error(`Main function error: ${error.message}`);
    }
};

main().catch(console.error);
