import java.util.Properties

plugins { id("com.android.application") }

// The IMAGOFORGE key, not the personal one. This app ships under
// com.imagoforge.sg4d, and the signing certificate is what Play ties a package
// to permanently - so it has to match the owner of the package name, and it has
// to be right before the first upload rather than after.
//
// Both this file and the keystore it names live one level above the repo, so
// neither is ever committed. If the file is missing the build still configures,
// then fails at signing with a null password rather than silently producing an
// unsigned or debug-signed release.
val keystoreProps = Properties().apply {
  val f = rootProject.file("../../imagoforge-keystore.properties")
  if (f.exists()) f.inputStream().use { load(it) }
}

android {
  namespace = "com.imagoforge.sg4d"
  compileSdk { version = release(36) { minorApiLevel = 1 } }

  defaultConfig {
    applicationId = "com.imagoforge.sg4d"
    minSdk = 24
    targetSdk = 36
    versionCode = 5
    versionName = "1.3"
  }

  signingConfigs {
    create("release") {
      storeFile = rootProject.file("../../" + keystoreProps.getProperty("storeFile", "imagoforge-release.jks"))
      storePassword = keystoreProps.getProperty("storePassword")
      keyAlias = keystoreProps.getProperty("keyAlias")
      keyPassword = keystoreProps.getProperty("keyPassword")
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      signingConfig = signingConfigs.getByName("release")
    }
  }
}

dependencies {
  // Google Mobile Ads (AdMob). Ad unit ids live in res/values/ads.xml.
  implementation("com.google.android.gms:play-services-ads:25.4.0")
  // WebViewAssetLoader, so the page is served from an https origin rather than
  // file:// - see the comment at the top of MainActivity for why that matters
  // to an app that has to make cross-origin API calls.
  implementation("androidx.webkit:webkit:1.17.0")
  // Background result checks and the notification they post. WorkManager
  // because the check has to survive the app being closed and the device
  // rebooting, which a plain alarm or a coroutine does not.
  implementation("androidx.work:work-runtime:2.10.0")
  implementation("androidx.core:core:1.15.0")
}
