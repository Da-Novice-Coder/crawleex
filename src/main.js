import { PlaywrightCrawler, Dataset } from 'crawlee';

const baseUrl = 'https://www.xvideos.com/';

// Define routes
const router = {
    MOVIE_LIST: 'MOVIE_LIST',
    MOVIE_DETAIL: 'MOVIE_DETAIL',
};

// Handler for movie list pages
const handleMovieList = async ({ request, page, enqueueLinks, log }) => {
    log.info(`Processing movie list page: ${request.url}`);

    // Enqueue links to individual movies
    await enqueueLinks({
        selector: '.thumb-block .thumb a',
        baseUrl,
        label: router.MOVIE_DETAIL,
    });

    // Enqueue next page
    await enqueueLinks({
        selector: '.pagination ul .next-page',
        baseUrl,
        label: router.MOVIE_LIST,
    });
};

// Handler for movie detail pages
const handleMovieDetail = async ({ request, page, log }) => {
    log.info(`Processing movie detail page: ${request.url}`);

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
        
        Object.entries(regexMap).forEach(([key, regex]) => {
            const match = text.match(regex);
            data[key] = match ? match[1] : null;
        });

        const videoQuality = document.querySelector('.video-hd-mark')?.textContent || '';
        const metadata = [...document.querySelectorAll('.video-metadata > ul li.model')];
        const actress = metadata.map(li => li.querySelector('a').href.split('/')[4]);
        const tags = [...document.querySelectorAll('.is-keyword')].map(el => el.innerText);
        const duration = document.querySelector('.duration')?.textContent || '';
        const views = document.querySelector('#v-views .mobile-hide')?.textContent || '';
        const comments = document.querySelector('.comments .badge')?.textContent || '';
        
        return { ...data, actress, videoQuality, duration, views, comments, tags };
    });

    if (movie) {
        await Dataset.pushData(movie);
    }
};

// Create the crawler
const crawler = new PlaywrightCrawler({
    async requestHandler({ request, page, enqueueLinks, log }) {
        // Use the router to determine which handler to use
        switch (request.label) {
            case router.MOVIE_LIST:
                return handleMovieList({ request, page, enqueueLinks, log });
            case router.MOVIE_DETAIL:
                return handleMovieDetail({ request, page, log });
            default:
                log.info(`Unrecognized route: ${request.url}`);
        }
    },
    maxRequestsPerCrawl: 100,
    maxConcurrency: 10,
});

// Run the crawler
(async () => {
    await crawler.run([{
        url: baseUrl,
        label: router.MOVIE_LIST, // Start with the movie list route
    }]);
    console.log('Crawler finished.');
})();