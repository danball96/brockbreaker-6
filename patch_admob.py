import re
import subprocess

# MainActivity.java を検索
result = subprocess.run(['find', 'android', '-name', 'MainActivity.java'], capture_output=True, text=True)
path = result.stdout.strip().split('\n')[0]
print("Found MainActivity:", path)

with open(path, 'r') as f:
    content = f.read()

# AdMob 用 import を追加（class 宣言の直前）
admob_imports = (
    "import com.google.android.gms.ads.MobileAds;\n"
    "import com.google.android.gms.ads.AdRequest;\n"
    "import com.google.android.gms.ads.AdSize;\n"
    "import com.google.android.gms.ads.AdView;\n"
    "import android.widget.FrameLayout;\n"
    "import android.view.Gravity;\n"
    "import android.view.ViewGroup;\n"
)
content = re.sub(r'(?=public class MainActivity)', admob_imports, content)

# バナー広告の初期化コードを super.onCreate() の直後に追加
# addContentView() ではなく、WebViewと同じ親レイアウト（android.R.id.content）に追加する
admob_code = (
    "\n        MobileAds.initialize(this, s -> {\n        });\n"
    "        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {\n"
    "            public void run() {\n"
    "                try {\n"
    "                    AdView adView = new AdView(MainActivity.this);\n"
    "                    adView.setAdUnitId(\"ca-app-pub-3940256099942544/6300978111\");\n"
    "                    adView.setAdSize(AdSize.BANNER);\n"
    "                    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(\n"
    "                        FrameLayout.LayoutParams.MATCH_PARENT,\n"
    "                        FrameLayout.LayoutParams.WRAP_CONTENT);\n"
    "                    lp.gravity = Gravity.BOTTOM;\n"
    "                    // WebViewと同じ親FrameLayoutに追加（WebViewの上に重ねる）\n"
    "                    FrameLayout contentFrame = (FrameLayout) getWindow().getDecorView().getRootView();\n"
    "                    contentFrame.addView(adView, lp);\n"
    "                    adView.loadAd(new AdRequest.Builder().build());\n"
    "                    android.util.Log.d(\"AdMob\", \"Banner ad loaded successfully\");\n"
    "                } catch (Exception e) {\n"
    "                    android.util.Log.e(\"AdMob\", \"Failed to load banner ad: \" + e.getMessage());\n"
    "                }\n"
    "            }\n"
    "        }, 2000);\n"
)
content = re.sub(r'(super\.onCreate\(savedInstanceState\);)', r'\1' + admob_code, content)

with open(path, 'w') as f:
    f.write(content)

print("MainActivity updated successfully.")
print("--- Modified file ---")
print(content)
