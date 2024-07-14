import { PlaywrightCrawler, Dataset } from 'crawlee';

const baseUrl = 'https://www.xvideos.com/';

const crawler = new PlaywrightCrawler({
    async requestHandler({ page, request, enqueueLinks }) {
        console.log(`Processing: ${request.url}`);

        if (request.url.includes('/video/')) {
            // Movie detail page
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
        } else {
            // Movie listing page
            await enqueueLinks({
                selector: '.thumb-block .thumb a',
                baseUrl,
            });

            // Enqueue next page
            await enqueueLinks({
                selector: '.pagination ul .next-page',
                baseUrl,
            });
        }
    },
    maxRequestsPerCrawl: 100, // Adjust as needed
    maxConcurrency: 1, // Adjust based on your needs and the website's limitations
});

(async () => {
    await crawler.run([baseUrl]);
    console.log('Crawler finished.');
})();