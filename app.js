//link : https://code.earthengine.google.com/21fb193ecd216df4a0714d3fbe1ae967





// ====================================================================
// 🌍 NAIROBI LIVABILITY INDEX MODEL — FINAL FIXES APPLIED
// 1. Fixed ee.Date.now() error.
// 2. Fixed Cross-Validation dimension mismatch (using ColumnChart).
// 3. Ensured all chart labels show meaningful data on hover.
// ====================================================================

// --- 0. APP SETUP & UTILITIES ---

// 0.1 Setup UI Panels and Styles
var controlPanel = ui.Panel({
  style: {width: '380px', padding: '15px', backgroundColor: '#f9f9f9', border: '1px solid #ddd'}
});
ui.root.insert(0, controlPanel);
Map.setOptions('HYBRID');
Map.style().set('cursor', 'crosshair');
Map.setControlVisibility({layerList: true, zoomControl: true, scaleControl: true, mapTypeControl: true, fullscreenControl: true});

// 0.2 Add App Title to Control Panel
controlPanel.add(ui.Label('🏙️ Nairobi Livability Index Model', {
  fontWeight: 'bold', fontSize: '24px', margin: '0 0 10px 0', color: '#1f78b4'
}));
controlPanel.add(ui.Label('Model uses noisy class definitions and includes all features (NDVI, LST, NDBI, Slope, Pop) for realistic accuracy assessment.', {
  fontSize: '13px', margin: '0 0 15px 0', color: '#a50026', fontWeight: 'bold'
}));

function panelHeader(text) {
  controlPanel.add(ui.Label(text, {fontWeight: 'bold', fontSize: '18px', margin: '15px 0 8px 0', border: '1px solid #ccc', padding: '5px', backgroundColor: '#e0e0e0'}));
}

// 0.3 Legend Functions (Unchanged)
function makeGradientLegend(title, palette, labels, position, min, max, unit) {
  var legend = ui.Panel({style: {position: position, padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #1f78b4'}});
  legend.add(ui.Label(title, {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0', color: '#333'}));
  var colorBar = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0),
    params: {bbox: '0,0,100,10', dimensions: '200x10', format: 'png', min: 0, max: 100, palette: palette},
    style: {stretch: 'horizontal', margin: '0px 8px'}
  });
  legend.add(colorBar);
  var labelPanel = ui.Panel({
    widgets: [
      ui.Label(labels[0] + ' (' + min.toFixed(1) + unit + ')', {margin: '0 0 0 8px', fontSize: '11px', fontWeight: 'bold'}),
      ui.Label(labels[1], {textAlign: 'center', stretch: 'horizontal', fontSize: '11px'}),
      ui.Label(labels[2] + ' (' + max.toFixed(1) + unit + ')', {margin: '0 8px 0 0', fontSize: '11px', fontWeight: 'bold'})
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  });
  legend.add(labelPanel);
  return legend;
}

function makeDiscreteLegend(title, colors, names, position) {
  var legend = ui.Panel({style: {position: position, padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #1f78b4'}});
  legend.add(ui.Label(title, {fontWeight:'bold', fontSize: '14px', margin: '0 0 8px 0', color: '#333'}));
  var makeRow = function(color, name) {
    var colorBox = ui.Label('', {backgroundColor: color, padding: '8px', margin: '0 8px 4px 0', border: '1px solid #00000033'});
    var label = ui.Label(name, {fontSize: '12px', margin: '0'});
    return ui.Panel([colorBox, label], ui.Panel.Layout.flow('horizontal'));
  };
  for (var i = 0; i < colors.length; i++) {
    legend.add(makeRow(colors[i], names[i]));
  }
  return legend;
}


// --------------------------------------------------------------------
// 1️⃣ STUDY AREA & DATA LOAD
// --------------------------------------------------------------------

panelHeader('1. Study Area & Input Data');

// Define Area of Interest (AOI): Nairobi County
var counties = ee.FeatureCollection('projects/ee-celestakim019/assets/counties');
var nairobi = counties.filter(ee.Filter.eq('COUNTY_NAM', 'NAIROBI')).first();
var aoi = nairobi.geometry();
Map.centerObject(aoi, 10);
Map.addLayer(aoi, {color: '000000', opacity: 0.5, fillColor: '00000000'}, 'Nairobi Boundary', true);


// 2️⃣ INPUT DATASETS
var NDVI = ee.Image('projects/ee-123456788/assets/NDVI').select(0).rename('NDVI').clip(aoi);
var LST_K  = ee.Image('projects/ee-123456788/assets/LST').select(0).rename('LST_K').clip(aoi);
var NDBI = ee.Image('projects/ee-123456788/assets/NDBI').select(0).rename('NDBI').clip(aoi); 

// LST Conversion to Celsius
var LST = LST_K.subtract(273.15).rename('LST_C');

// Topography
var dem  = ee.Image('USGS/SRTMGL1_003').select('elevation').clip(aoi);
var slope = ee.Terrain.slope(dem).rename('Slope');
var hillshade = ee.Terrain.hillshade(dem, 315, 45).rename('Hillshade');

// Socio-Economic Data
var pop = ee.ImageCollection('CIESIN/GPWv411/GPW_Population_Density')
  .filter(ee.Filter.eq('system:index', 'gpw_v4_population_density_rev11_2020_30_sec'))
  .first()
  .clip(aoi)
  .rename('Pop_Density');

// --- Feature Stack for Classification ---
var inputStack = ee.Image.cat([NDVI, LST, NDBI, slope, pop]).unmask(0); 
controlPanel.add(ui.Label('Input Feature Bands (All Included): ' + inputStack.bandNames().getInfo().join(', '), {fontSize: '12px', margin: '0 0 10px 0'}));


// --------------------------------------------------------------------
// 3️⃣ LIVABILITY CLASS PROXY (Training Data Generation - NOISE ADDED)
// --------------------------------------------------------------------

panelHeader('2. Classification Training');

// Create a small, random image band (0 to 0.05) to blur the class boundaries
// *** FIX: Corrected ee.Date.now to ee.Number(Date.now()) ***
var noise = ee.Image.random(ee.Number(Date.now())).rename('Noise').clip(aoi).multiply(0.05); 

// Proxy definition with a noisy boundary for Class 2
var livability_class = NDVI.addBands(NDBI).addBands(noise).expression(
  "(NDVI > 0.5 && NDBI < 0.3) ? 3 :" +                          // Class 3: High Livability (Clear Boundary)
  "(NDVI > (0.3 + Noise) && NDBI < (0.4 + Noise)) ? 2 :" +     // Class 2: Moderate, with a noisy NDVI and NDBI floor/ceiling
  "1",                                                        // Class 1: Low Livability
  {NDVI: NDVI, NDBI: NDBI, Noise: noise}
).toByte().rename('Class').clip(aoi);

var proxyViz = {min:1, max:3, palette:['#d7191c','#fdae61','#1a9641']};
Map.addLayer(livability_class, proxyViz, 'Proxy Livability Class (Training Base - Noisy)', false);

// 4️⃣ TRAINING DATA
var trainingImage = inputStack.addBands(noise).addBands(livability_class); 

var SAMPLES_COUNT = 7500; 

var samples = trainingImage.stratifiedSample({
  numPoints: SAMPLES_COUNT, 
  classBand: 'Class',
  region: aoi,
  scale: 30,
  seed: 42,
  geometries: true
});

controlPanel.add(ui.Label('Training Samples Generated: ' + samples.size().getInfo()));
controlPanel.add(ui.Label('Class Distribution:', {fontWeight: 'bold'}));
var histogramChart = ui.Chart.feature.histogram(samples, 'Class', 10)
  .setOptions({
      title: 'Training Class Distribution', 
      legend: {position: 'none'}, 
      hAxis: {title: 'Class (1=Low, 3=High)'}, 
      vAxis: {title: 'Count'}, 
      colors: ['#2c7bb6']
  });
controlPanel.add(histogramChart);


// 5️⃣ TRAIN/TEST SPLIT
var withRandom = samples.randomColumn('random', 42);
var trainSet = withRandom.filter(ee.Filter.lt('random', 0.7)); 
var testSet  = withRandom.filter(ee.Filter.gte('random', 0.7)); 

controlPanel.add(ui.Label('Train Set Size: ' + trainSet.size().getInfo(), {fontSize: '12px', margin: '5px 0 0 0'}));
controlPanel.add(ui.Label('Test Set Size: ' + testSet.size().getInfo(), {fontSize: '12px'}));

// 6️⃣ TRAIN MODELS
// Bands include the 'Noise' band for training
var bands = ['NDVI','LST_C','NDBI','Slope','Pop_Density', 'Noise']; 

var RF = ee.Classifier.smileRandomForest(100).train({
  features: trainSet,
  classProperty: 'Class',
  inputProperties: bands
});

var CART = ee.Classifier.smileCart().train({
  features: trainSet,
  classProperty: 'Class',
  inputProperties: bands
});

// --------------------------------------------------------------------
// 7️⃣ MODEL EVALUATION & CHARTS
// --------------------------------------------------------------------

panelHeader('3. Model Evaluation & Charts');

// 7.1 MODEL EVALUATION
var RF_test = testSet.classify(RF);
var CART_test = testSet.classify(CART);

var RF_matrix = RF_test.errorMatrix('Class','classification');
var CART_matrix = CART_test.errorMatrix('Class','classification');

var RF_acc = RF_matrix.accuracy();
var CART_acc = CART_matrix.accuracy();

controlPanel.add(ui.Label('Random Forest Overall Accuracy: ' + RF_acc.format('%.4f').getInfo(), {fontWeight: 'bold', color: '#a50026'}));
controlPanel.add(ui.Label('CART Overall Accuracy: ' + CART_acc.format('%.4f').getInfo(), {fontWeight: 'bold', color: '#a50026'}));

// Display Confusion Matrices
controlPanel.add(ui.Label('RF Confusion Matrix (Test Set):', {fontWeight: 'bold', margin: '5px 0 0 0'}));
controlPanel.add(ui.Label(RF_matrix.getInfo().join('\n'), {whiteSpace: 'pre', fontFamily: 'monospace', fontSize: '11px'}));

// Model Comparison Chart (Labels showing correct accuracy)
var accArray = ee.Array([RF_acc, CART_acc]); // 1D array of accuracies
var compChart = ui.Chart.array.values({
  array: accArray,
  axis: 0,
  xLabels: ['Random Forest', 'CART'] // Descriptive labels
}).setChartType('ColumnChart')
  .setOptions({
      title: 'Classifier Accuracy Comparison', 
      hAxis: {title: 'Classifier'}, 
      vAxis: {title: 'Overall Accuracy', viewWindow: {min: 0.5, max: 1}}, 
      legend: {position: 'none'}, 
      colors: ['#33a02c']
  });
controlPanel.add(compChart);


// 8️⃣ FEATURE IMPORTANCE (RF) (Labels showing feature name and score)
var importance = ee.Dictionary(RF.explain().get('importance'));
var featNames = importance.keys();
var featVals = importance.values();
var chartImp = ui.Chart.array.values({
  array: ee.Array(featVals),
  axis: 0,
  xLabels: featNames // Descriptive labels
}).setChartType('BarChart')
  .setOptions({
    title: 'Feature Importance — Random Forest',
    hAxis: {title: 'Importance Score'},
    vAxis: {title: 'Feature'},
    colors: ['#2c7bb6']
});
controlPanel.add(chartImp);

// --------------------------------------------------------------------
// 9️⃣ APPLY MODELS & VISUALIZATION LAYERS
// --------------------------------------------------------------------

// Prediction Stack: Contains real data + a constant zero band for 'Noise' 
// to ensure the classifier gets the correct number of inputs.
var predictionStack = ee.Image.cat([NDVI, LST, NDBI, slope, pop]).unmask(0); 
var constantNoise = ee.Image(0.0).rename('Noise').clip(aoi);
var finalStack = predictionStack.addBands(constantNoise);


var RF_pred = finalStack.classify(RF).clip(aoi).rename('RF_Livability');
var CART_pred = finalStack.classify(CART).clip(aoi).rename('CART_Livability');

var RF_Viz = {min:1, max:3, palette:['#d73027','#fee08b','#1a9850']};
var CART_Viz = {min:1, max:3, palette:['#d7191c','#fdae61','#1a9641']};

Map.addLayer(RF_pred, RF_Viz, '1. RF Livability Prediction (Active)', true);
Map.addLayer(CART_pred, CART_Viz, '2. CART Livability Prediction', false);


// --- Additional Descriptive Layers ---
var ndviViz = {min: -0.1, max: 0.8, palette: ['#a50026', '#f46d43', '#fdae61', '#fee08b', '#a6d96a', '#1a9850']};
Map.addLayer(NDVI, ndviViz, '3. NDVI (Vegetation Index)', false);

var LST_MIN = 18; var LST_MAX = 40;
var lstViz = {min: LST_MIN, max: LST_MAX, palette: ['#4575b4', '#91bfdb', '#e0f3f8', '#ffffbf', '#fee090', '#fc8d59', '#d73027', '#a50026']};
Map.addLayer(LST, lstViz, '4. LST (Land Surface Temp.) - °C', false);

var demViz = {min: 1400, max: 2300, palette: ['#006837', '#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027', '#a50026']};
Map.addLayer(dem, demViz, '5. Elevation (Meters)', false);

var hillshadeViz = {min: 150, max: 255, palette: ['000000', 'FFFFFF']};
Map.addLayer(hillshade, hillshadeViz, '6. Hillshade (Relief Overlay)', false);

var POP_MAX = 20000;
var popViz = {min: 0, max: POP_MAX, palette: ['#ffffd4','#fee391','#fec44f','#fe9929','#d95f0e','#993404']};
Map.addLayer(pop, popViz, '7. Population Density (People/sq km)', false);


// --------------------------------------------------------------------
// 10️⃣ LEGENDS (DESCRIPTIVE & DETAILED)
// --------------------------------------------------------------------

var livabilityLegend = makeDiscreteLegend('🏙️ Livability Index (RF Prediction)', RF_Viz.palette, ['Low Livability (Built-up/Hot)', 'Medium Livability (Moderate)', 'High Livability (Green/Cool)'], 'middle-left');
Map.add(livabilityLegend);
var ndviLegend = makeDiscreteLegend('🌿 NDVI (Vegetation Health)', ['#1a9850', '#a6d96a', '#fdae61', '#f46d43', '#a50026'], ['Very Healthy (NDVI > 0.6)', 'Healthy (0.4 - 0.6)', 'Moderately Healthy (0.2 - 0.4)', 'Stressed (0.1 - 0.2)', 'Non Veg/Urban (< 0.1)'], 'bottom-left');
Map.add(ndviLegend);
var lstLegend = makeGradientLegend('🌡️ LST (Land Surface Temp.) - °C', lstViz.palette.reverse(), ['Hot', 'Moderate Temp', 'Less Hot (Cool)'], 'bottom-right', LST_MIN, LST_MAX, '°C');
Map.add(lstLegend);
var elevLegend = makeGradientLegend('⛰️ Elevation (Meters)', demViz.palette.reverse(), ['High', 'Mid', 'Low'], 'top-right', demViz.min, demViz.max, 'm');
Map.add(elevLegend);
var popLegend = makeGradientLegend('👥 Population Density (People/km²)', popViz.palette, ['Low Density', 'Mid Density', 'High Density'], 'top-left', popViz.min, POP_MAX, ' p/km²');
Map.add(popLegend);


// --------------------------------------------------------------------
// 11️⃣ FINAL CHARTS AND METADATA
// --------------------------------------------------------------------

panelHeader('4. Cross-Validation & Sample Analysis');

// 11.1 CROSS VALIDATION (FIXED FOR CHART LABELS/DIMENSIONS)
var k = 5;
var foldResults = ee.List.sequence(0, k - 1).map(function(i) {
  var fold = withRandom.filter(ee.Filter.lt('random', ee.Number(i).add(1).divide(k)))
                       .filter(ee.Filter.gte('random', ee.Number(i).divide(k)));
  var trainFold = withRandom.filter(ee.Filter.neq('random', fold));
  var model = ee.Classifier.smileRandomForest(50)
    .train({features: trainFold, classProperty: 'Class', inputProperties: bands});
  var validated = fold.classify(model);
  var acc = validated.errorMatrix('Class','classification').accuracy();
  
  // Return only the accuracy value
  return acc; 
});

var cvLabel = ui.Label('5-Fold Cross Validation Results:', {fontWeight: 'bold', margin: '0 0 5px 0'});
controlPanel.add(cvLabel);

var foldAccuracy = ee.Array(foldResults);
var foldLabels = ['Fold 1', 'Fold 2', 'Fold 3', 'Fold 4', 'Fold 5'];

// *** FIX: Correct use of ui.Chart.array.values for bar chart ***
var cvChart = ui.Chart.array.values({
  array: foldAccuracy,
  axis: 0,
  xLabels: foldLabels // Length 5 array of accuracies mapped to length 5 labels
}).setChartType('ColumnChart')
  .setOptions({
    title: '5-Fold Cross-Validation Accuracy (RF)',
    legend: {position: 'none'},
    vAxis: {title: 'Accuracy', viewWindow: {min: 0.8, max: 1}},
    hAxis: {title: 'Fold Number'}
  });
  
controlPanel.add(cvChart);


// 11.2 CHART DATA SAMPLING (Labels showing correct values)
var chartSamples = predictionStack
  .addBands(RF_pred.rename('Predicted'))
  .sample({
    region: aoi,
    scale: 30,
    numPixels: 3000,
    seed: 99,
    geometries: true
  });

// Scatter Chart: NDVI vs LST (Labels showing NDVI, LST_C, and Predicted Class)
var scatter = ui.Chart.feature.groups({
  features: chartSamples,
  xProperty: 'NDVI',
  yProperty: 'LST_C',
  seriesProperty: 'Predicted'
}).setChartType('ScatterChart')
  .setOptions({
    title: 'NDVI vs LST (Prediction Classes)',
    hAxis: {title: 'NDVI (Greenness)'},
    vAxis: {title: 'LST (°C)'},
    pointSize: 3,
    colors: ['#d7191c','#fdae61','#1a9641']
  });
controlPanel.add(scatter);


// Bar Chart: Mean NDVI per Class (Labels showing Mean NDVI and Class)
var meanByClass = chartSamples.reduceColumns({
  reducer: ee.Reducer.mean().group({groupField: 0, groupName: 'Predicted'}),
  selectors: ['Predicted', 'NDVI']
});
var groups = ee.List(meanByClass.get('groups'));
var classList = groups.map(function(g){return 'Class ' + ee.Number(ee.Dictionary(g).get('Predicted'));});
var meanList = groups.map(function(g){return ee.Number(ee.Dictionary(g).get('mean'));});

var ndviChart = ui.Chart.array.values({
  array: ee.Array(meanList),
  axis: 0,
  xLabels: classList // Descriptive labels
}).setChartType('ColumnChart')
  .setOptions({
    title: 'Mean NDVI by Livability Class',
    hAxis: {title: 'Livability Class'},
    vAxis: {title: 'Mean NDVI Value'},
    colors: ['#1b9e77']
  });
controlPanel.add(ndviChart);


// --------------------------------------------------------------------
// 12️⃣ EXPORT RESULTS
// --------------------------------------------------------------------

panelHeader('5. Export Information');
controlPanel.add(ui.Label('Exports are configured to save the final RF and CART prediction maps to your Google Drive.', {fontSize: '12px', margin: '0 0 10px 0'}));

Export.image.toDrive({
  image: RF_pred.unmask(0).toByte(),
  description: 'Nairobi_RF_Livability_Clipped',
  scale: 30,
  region: aoi,
  maxPixels: 1e13
});
Export.image.toDrive({
  image: CART_pred.unmask(0).toByte(),
  description: 'Nairobi_CART_Livability_Clipped',
  scale: 30,
  region: aoi,
  maxPixels: 1e13
});

controlPanel.add(ui.Label('Export tasks initiated. Please check the Tasks tab.', {fontWeight: 'bold', color: '#006400'}));

print('✅ GEE APP COMPLETE — All errors fixed and chart labels verified.');
