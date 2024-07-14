import { PlaywrightCrawler, Dataset } from 'crawlee';
import { connectDB, saveMovie } from './database.js';
import logger from './logger.js';
import dotenv from 'dotenv';

dotenv.config();

const baseUrl = 'https://www.xvideos.com/';
const proxyUrl = `http://${process.env.PROXY_USERNAME}:${process.env.PROXY_PASSWORD}@${process.env.PROXY_SERVER}`;

const crawler = new PlaywrightCrawler({
    proxyUrl,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 60,
    async requestHandler({ request, page, enqueueLinks }) {
        const url = request.url;

        if (url.includes('/video')) {
            await handleMoviePage(page, url);
        } else {
            await handleListingPage(page, enqueueLinks);
        }
    },
    failedRequestHandler({ request, error }) {
        logger.error(`Request ${request.url} failed with error: ${error.message}`);
    },
});

async function handleMoviePage(page, url) {
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
        logger.info(`Scraped movie: ${movie.title}`);
    }
}

async function handleListingPage(page, enqueueLinks) {
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
}

async function main() {
    await connectDB();
    
    await crawler.run([baseUrl]);
    
    logger.info('Crawler finished.');
}

main().catch(console.error);