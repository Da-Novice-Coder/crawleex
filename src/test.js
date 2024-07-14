import { PlaywrightCrawler, Dataset} from 'crawlee';

import logger from './logger.js';

const baseUrl = 'https://www.xvideos.com';

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
            await Dataset.pushData(movie);
            logger.info(`Scraped movie: ${movie.title}`);
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

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 60,
    async requestHandler({ request, page, enqueueLinks}) {
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
        await crawler.run([baseUrl]);
        logger.info('Crawler finished.');
    } catch (error) {
        logger.error(`Main function error: ${error.message}`);
    }
};

main().catch(console.error);
