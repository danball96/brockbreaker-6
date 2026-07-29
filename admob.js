import { AdMob, BannerAdSize, BannerAdPosition, BannerAdPluginEvents } from '@capacitor-community/admob';

export async function initAdMob() {
    try {
        await AdMob.initialize({
            initializeForTesting: true,
        });

        // 広告がクリックされた時やフルスクリーンになった時にゲームを一時停止
        const pauseEvent = () => window.dispatchEvent(new Event('pauseGameFromAd'));
        
        AdMob.addListener(BannerAdPluginEvents.AdOpened, pauseEvent);
        AdMob.addListener(BannerAdPluginEvents.AdClicked, pauseEvent);

        const options = {
            adId: 'ca-app-pub-3940256099942544/6300978111',
            adSize: BannerAdSize.BANNER,
            position: BannerAdPosition.BOTTOM_CENTER,
            margin: 0,
            isTesting: true,
        };

        await AdMob.showBanner(options);
    } catch (e) {
        console.error("AdMob Init Error:", e);
    }
}

initAdMob();
