import re
import subprocess

# MainActivity.java を検索
result = subprocess.run(['find', 'android', '-name', 'MainActivity.java'], capture_output=True, text=True)
path = result.stdout.strip().split('\n')[0]
print("Found MainActivity:", path)

with open(path, 'r') as f:
    content = f.read()

print("=== ORIGINAL FILE ===")
print(content)
print("=== END ORIGINAL ===")

# AdMob 用 import を追加
admob_imports = (
    "import android.os.Bundle;\n"
    "import android.view.Gravity;\n"
    "import android.widget.FrameLayout;\n"
    "import android.view.ViewGroup;\n"
    "import com.google.android.gms.ads.AdRequest;\n"
    "import com.google.android.gms.ads.AdSize;\n"
    "import com.google.android.gms.ads.AdView;\n"
    "import com.google.android.gms.ads.MobileAds;\n"
)

# 既にimportがある場合は重複を避ける
if "import com.google.android.gms.ads.MobileAds;" not in content:
    content = re.sub(r'(?=public class MainActivity)', admob_imports, content)

# バナー広告コード
admob_banner_code = (
    "        MobileAds.initialize(this, s -> {\n"
    "        });\n"
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
    "                    FrameLayout decorView = (FrameLayout) getWindow().getDecorView();\n"
    "                    decorView.addView(adView, lp);\n"
    "                    adView.loadAd(new AdRequest.Builder().build());\n"
    "                    android.util.Log.d(\"AdMob\", \"Banner ad added to decorView\");\n"
    "                } catch (Exception e) {\n"
    "                    android.util.Log.e(\"AdMob\", \"Error: \" + e.getMessage());\n"
    "                }\n"
    "            }\n"
    "        }, 2000);\n"
)

if 'super.onCreate' in content:
    # すでにonCreateがある場合はsuper.onCreate()の直後に挿入
    print("INFO: onCreate already exists. Inserting after super.onCreate.")
    content = re.sub(
        r'(super\.onCreate\([^)]*\);)',
        r'\1\n' + admob_banner_code,
        content
    )
else:
    # onCreateが存在しない場合（Capacitorのデフォルト）は新しく追加
    print("INFO: onCreate not found. Adding new onCreate method.")
    new_oncreate = (
        "\n    @Override\n"
        "    protected void onCreate(Bundle savedInstanceState) {\n"
        "        super.onCreate(savedInstanceState);\n"
        + admob_banner_code +
        "    }\n"
    )
    # クラス本体の開始 { の直後に挿入
    content = re.sub(
        r'(public class MainActivity extends BridgeActivity\s*\{)',
        r'\1' + new_oncreate,
        content
    )

with open(path, 'w') as f:
    f.write(content)

print("=== MODIFIED FILE ===")
print(content)
print("=== END MODIFIED ===")
print("Done.")
