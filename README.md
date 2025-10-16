#KIMATHI JORAM CELESTAKIM018@GMAIL.COM
# 🏙️ Nairobi Livability Index Model (Google Earth Engine App)

This is a **Google Earth Engine (GEE)** application designed to model and classify the **Livability Index** across **Nairobi County, Kenya**, using supervised machine learning classification.

The model is built on the premise of **realistic accuracy assessment** by intentionally introducing a **"noisy" element** into the training data generation, simulating the ambiguity and complexity often found in real-world classification boundaries.

---

### ✨ Key Features and Objectives

* **Realistic Classification:** Employs a unique method to create a proxy livability map with **noisy class boundaries** to challenge the classifiers and yield more representative accuracy metrics.
* **Comprehensive Features:** Uses a stack of five key input features:
    * **NDVI** (Vegetation Index)
    * **LST** (Land Surface Temperature in **°C**)
    * **NDBI** (Normalized Difference Built-up Index)
    * **Slope** (Topography)
    * **Population Density** (People/km²)
* **Comparative Modeling:** Trains and evaluates two robust classifiers: **Random Forest (RF)** and **Classification and Regression Tree (CART)**.
* **Detailed Evaluation:** Provides in-depth analysis including **Overall Accuracy**, **Confusion Matrix**, **Feature Importance**, and **5-Fold Cross-Validation**.
* **Interactive Visualization:** Displays the final prediction maps alongside multiple feature layers (LST, NDVI, Population) with **dynamic, descriptive legends**.

---

### 🚀 How to Use the App

1.  **Open in Google Earth Engine:** Load the script into your GEE Code Editor.
2.  **Run the Script:** Press the **Run** button.
3.  **Explore the Map:** The map will center on Nairobi, displaying the **Random Forest Prediction** layer by default.
4.  **View Results:** The left-hand **Control Panel** contains all the interactive outputs:
    * Training Sample Distribution
    * Overall Accuracy and Confusion Matrix
    * Classifier Comparison Chart
    * Feature Importance Chart
    * 5-Fold Cross-Validation Chart
    * NDVI vs LST Scatter Plot
5.  **Toggle Layers:** Use the **Layers** panel to switch between the **RF** and **CART** predictions, or view the raw input feature data (NDVI, LST, Pop Density, etc.).
6.  **Check Exports:** The script automatically initiates two export tasks for the final classified maps. Check the **Tasks** tab (top right of the GEE interface) to approve and start the download to your Google Drive.

---

### 📋 Technical Details & Data

| Section | Description | Implementation Details |
| :--- | :--- | :--- |
| **Livability Classes** | Three classes are defined using noisy NDVI and NDBI thresholds: Low (1), Medium (2), and High (3). | Defined via `ee.Image.expression` and sampled using **7,500 stratified points**. |
| **Training/Test** | The 7,500 samples are split $70\%$ for training and $30\%$ for testing (Test Set Size: $\approx 2,250$ points). | Uses `randomColumn('random', 42)` for consistent splitting. |
| **Classification** | RF is configured with 100 trees. Models are trained on the 6 bands (5 features + **Noise**). | `ee.Classifier.smileRandomForest(100)` and `ee.Classifier.smileCart()`. |
| **Prediction** | For the final map prediction, the **Noise** band is supplied as a **constant zero image** to apply the model to real-world data. | Ensures the input band count matches the trained model structure. |

---

### ✅ Fixes and Improvements in this Version

This script incorporates critical fixes to ensure stability and reliable chart outputs:

* **Error Fix:** Resolved the `ee.Date.now()` error by switching to `ee.Number(Date.now())` for creating the random seed for the noise layer.
* **Chart Coherence:** Corrected dimension and formatting issues in the **Cross-Validation** and **Model Comparison** charts, ensuring correct data binding and descriptive axis labels.
* **Visualization Clarity:** All charts are configured to display **meaningful data labels** (e.g., the exact accuracy score, mean NDVI value, or feature name) on hover.<img width="1918" height="1033" alt="image" src="https://github.com/user-attachments/assets/7199bbc0-390c-49eb-8316-729f54b968f3" />
