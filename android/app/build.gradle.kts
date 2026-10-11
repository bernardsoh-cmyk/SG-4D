import java.util.Properties

plugins { id("com.android.application") }

val keystoreProps = Properties().apply {
  val f = rootProject.file("../../keystore.properties")
  if (f.exists()) f.inputStream().use { load(it) }
}

android {
  namespace = "com.imagoforge.sg4d"
  compileSdk { version = release(36) { minorApiLevel = 1 } }

  defaultConfig {
    applicationId = "com.imagoforge.sg4d"
    minSdk = 24
    targetSdk = 36
    versionCode = 4
    versionName = "1.2"
  }

  signingConfigs {
    create("release") {
      storeFile = rootProject.file("../../" + keystoreProps.getProperty("storeFile", "release-key.jks"))
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
}
