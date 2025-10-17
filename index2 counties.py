import ee
import json
import numpy as np
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)

# Initialize Earth Engine
def initialize_earth_engine():
    try:
        # Load service account key
        service_account = 'celesta-kim@ee-celestakim019.iam.gserviceaccount.com'
        credentials = ee.ServiceAccountCredentials(service_account, 'Kenya-Earth-Engine-Analysis/key.json')
        ee.Initialize(credentials)
        print("Earth Engine initialized successfully")
        return True
    except Exception as e:
        print(f"Failed to initialize Earth Engine: {e}")
        return False

# Load counties data
def load_counties():
    try:
        counties = ee.FeatureCollection('projects/ee-celestakim019/assets/counties')
        return counties
    except Exception as e:
        print(f"Failed to load counties: {e}")
        return None

# Cloud masking function for Sentinel-2
def mask_s2_clouds(image):
    qa = image.select('QA60')
    cloud_bit_mask = 1 << 10
    cirrus_bit_mask = 1 << 11
    mask = qa.bitwiseAnd(cloud_bit_mask).eq(0).And(qa.bitwiseAnd(cirrus_bit_mask).eq(0))
    return image.updateMask(mask).divide(10000)

# Cloud masking function for Landsat-8
def mask_l8_clouds(image):
    qa = image.select('QA_PIXEL')
    cloud_shadow_bit_mask = 1 << 3
    clouds_bit_mask = 1 << 5
    mask = qa.bitwiseAnd(cloud_shadow_bit_mask).eq(0).And(qa.bitwiseAnd(clouds_bit_mask).eq(0))
    return image.updateMask(mask)

# Apply scaling factors for Landsat-8
def apply_landsat_scale_factors(image):
    optical_bands = image.select('SR_B.*').multiply(0.0000275).add(-0.2)
    thermal_bands = image.select('ST_B.*').multiply(0.00341802).add(149.0)
    return image.addBands(optical_bands, None, True).addBands(thermal_bands, None, True)

# Calculate NDVI
def calculate_ndvi(image, satellite_type):
    if satellite_type == 'sentinel2':
        nir = image.select('B8')
        red = image.select('B4')
    elif satellite_type == 'landsat8':
        nir = image.select('SR_B5')
        red = image.select('SR_B4')
    else:
        return None

    ndvi = nir.subtract(red).divide(nir.add(red)).rename('NDVI')
    return image.addBands(ndvi)

# Classify NDVI into 5 classes
def classify_ndvi(ndvi_image):
    # Define NDVI classes
    # 1. Non-vegetation: NDVI < 0.1 (Red)
    # 2. Stressed vegetation: 0.1 <= NDVI < 0.3 (Orange)
    # 3. Moderately healthy: 0.3 <= NDVI < 0.5 (Yellow)
    # 4. Healthy: 0.5 <= NDVI < 0.7 (Light Green)
    # 5. Very healthy: NDVI >= 0.7 (Dark Green)

    classified = ndvi_image.select('NDVI').lt(0.1).multiply(1) \
        .add(ndvi_image.select('NDVI').gte(0.1).And(ndvi_image.select('NDVI').lt(0.3)).multiply(2)) \
        .add(ndvi_image.select('NDVI').gte(0.3).And(ndvi_image.select('NDVI').lt(0.5)).multiply(3)) \
        .add(ndvi_image.select('NDVI').gte(0.5).And(ndvi_image.select('NDVI').lt(0.7)).multiply(4)) \
        .add(ndvi_image.select('NDVI').gte(0.7).multiply(5))

    return classified.rename('NDVI_Class')

# Get Sentinel-2 data for a county
@app.route('/api/sentinel2', methods=['POST'])
def get_sentinel2_data():
    try:
        data = request.get_json()
        county_code = data.get('county_code')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        cloud_percentage = data.get('cloud_percentage', 20)

        if not all([county_code, start_date, end_date]):
            return jsonify({'error': 'Missing required parameters'}), 400

        counties = load_counties()
        if not counties:
            return jsonify({'error': 'Failed to load counties data'}), 500

        # Filter county
        county = counties.filter(ee.Filter.eq('COUNTY_COD', int(county_code))).first()
        county_geom = county.geometry()

        # Get Sentinel-2 data
        dataset = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED') \
            .filterDate(start_date, end_date) \
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_percentage)) \
            .filterBounds(county_geom) \
            .map(mask_s2_clouds)

        # Calculate mean composite
        composite = dataset.mean().clip(county_geom)

        # Calculate NDVI
        ndvi_image = calculate_ndvi(composite, 'sentinel2')
        ndvi_classified = classify_ndvi(ndvi_image)

        # Get statistics
        stats = ndvi_image.select('NDVI').reduceRegion(
            reducer=ee.Reducer.mean().combine(ee.Reducer.stdDev(), '', True),
            geometry=county_geom,
            scale=10,
            maxPixels=1e9
        ).getInfo()

        # Create visualization parameters with tile URLs
        rgb_viz = {
            'min': 0.0,
            'max': 0.3,
            'bands': ['B4', 'B3', 'B2'],
            'region': county_geom.getInfo()
        }

        # Get RGB tile URL
        rgb_tile_url = composite.select(['B4', 'B3', 'B2']).getMapId({
            'min': 0.0,
            'max': 0.3
        })['tile_fetcher'].url_format

        ndvi_viz = {
            'min': 0.0,
            'max': 1.0,
            'bands': ['NDVI'],
            'palette': ['#8B0000', '#FF4500', '#FFFF00', '#90EE90', '#006400'],
            'region': county_geom.getInfo()
        }

        # Get NDVI tile URL
        ndvi_tile_url = ndvi_classified.getMapId({
            'min': 1,
            'max': 5,
            'palette': ['#8B0000', '#FF4500', '#FFFF00', '#90EE90', '#006400']
        })['tile_fetcher'].url_format

        return jsonify({
            'success': True,
            'rgb_visualization': rgb_viz,
            'rgb_tile_url': rgb_tile_url,
            'ndvi_visualization': ndvi_viz,
            'ndvi_tile_url': ndvi_tile_url,
            'statistics': stats,
            'county_name': county.get('COUNTY_NAM').getInfo()
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Get Landsat-8 data for a county
@app.route('/api/landsat8', methods=['POST'])
def get_landsat8_data():
    try:
        data = request.get_json()
        county_code = data.get('county_code')
        start_date = data.get('start_date')
        end_date = data.get('end_date')

        if not all([county_code, start_date, end_date]):
            return jsonify({'error': 'Missing required parameters'}), 400

        counties = load_counties()
        if not counties:
            return jsonify({'error': 'Failed to load counties data'}), 500

        # Filter county
        county = counties.filter(ee.Filter.eq('COUNTY_COD', int(county_code))).first()
        county_info = county.getInfo()
        if not county_info:
            return jsonify({'error': f'County code {county_code} not found.'}), 404

        county_geom = county.geometry()

        # Get Landsat-8 data
        dataset = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2') \
            .filterDate(start_date, end_date) \
            .filterBounds(county_geom) \
            .map(mask_l8_clouds) \
            .map(apply_landsat_scale_factors)

        # Calculate mean composite
        composite = dataset.mean().clip(county_geom)

        # Calculate NDVI
        ndvi_image = calculate_ndvi(composite, 'landsat8')
        ndvi_classified = classify_ndvi(ndvi_image)

        # Get statistics
        stats = ndvi_image.select('NDVI').reduceRegion(
            reducer=ee.Reducer.mean().combine(ee.Reducer.stdDev(), '', True),
            geometry=county_geom,
            scale=30,
            maxPixels=1e9
        ).getInfo()

        # Create visualization parameters with tile URLs
        rgb_viz = {
            'min': 0.0,
            'max': 0.3,
            'bands': ['SR_B4', 'SR_B3', 'SR_B2'],
            'region': county_geom.getInfo()
        }

        # Get RGB tile URL
        rgb_tile_url = composite.select(['SR_B4', 'SR_B3', 'SR_B2']).getMapId({
            'min': 0.0,
            'max': 0.3
        })['tile_fetcher'].url_format

        ndvi_viz = {
            'min': 0.0,
            'max': 1.0,
            'bands': ['NDVI'],
            'palette': ['#8B0000', '#FF4500', '#FFFF00', '#90EE90', '#006400'],
            'region': county_geom.getInfo()
        }

        # Get NDVI tile URL
        ndvi_tile_url = ndvi_classified.getMapId({
            'min': 1,
            'max': 5,
            'palette': ['#8B0000', '#FF4500', '#FFFF00', '#90EE90', '#006400']
        })['tile_fetcher'].url_format

        return jsonify({
            'success': True,
            'rgb_visualization': rgb_viz,
            'rgb_tile_url': rgb_tile_url,
            'ndvi_visualization': ndvi_viz,
            'ndvi_tile_url': ndvi_tile_url,
            'statistics': stats,
            'county_name': county.get('COUNTY_NAM').getInfo()
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Get NDVI trend analysis
@app.route('/api/ndvi_trend', methods=['POST'])
def get_ndvi_trend():
    try:
        data = request.get_json()
        county_code = data.get('county_code')
        start_year = int(data.get('start_year', 2020))
        end_year = int(data.get('end_year', 2023))
        satellite = data.get('satellite', 'sentinel2')

        if not county_code:
            return jsonify({'error': 'Missing county code'}), 400

        counties = load_counties()
        if not counties:
            return jsonify({'error': 'Failed to load counties data'}), 500

        # Filter county
        county = counties.filter(ee.Filter.eq('COUNTY_COD', int(county_code))).first()
        county_info = county.getInfo()
        if not county_info:
            return jsonify({'error': f'County code {county_code} not found.'}), 404

        county_geom = county.geometry()

        trend_data = []

        for year in range(start_year, end_year + 1):
            start_date = f'{year}-01-01'
            end_date = f'{year}-12-31'

            try:
                if satellite == 'sentinel2':
                    dataset = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED') \
                        .filterDate(start_date, end_date) \
                        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20)) \
                        .filterBounds(county_geom) \
                        .map(mask_s2_clouds)

                    if dataset.size().getInfo() > 0:
                        composite = dataset.mean().clip(county_geom)
                        ndvi_image = calculate_ndvi(composite, 'sentinel2')

                        mean_ndvi = ndvi_image.select('NDVI').reduceRegion(
                            reducer=ee.Reducer.mean(),
                            geometry=county_geom,
                            scale=10,
                            maxPixels=1e9
                        ).get('NDVI').getInfo()

                        trend_data.append({
                            'year': year,
                            'ndvi': round(mean_ndvi, 4) if mean_ndvi else None
                        })

                elif satellite == 'landsat8':
                    dataset = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2') \
                        .filterDate(start_date, end_date) \
                        .filterBounds(county_geom) \
                        .map(mask_l8_clouds) \
                        .map(apply_landsat_scale_factors)

                    if dataset.size().getInfo() > 0:
                        composite = dataset.mean().clip(county_geom)
                        ndvi_image = calculate_ndvi(composite, 'landsat8')

                        mean_ndvi = ndvi_image.select('NDVI').reduceRegion(
                            reducer=ee.Reducer.mean(),
                            geometry=county_geom,
                            scale=30,
                            maxPixels=1e9
                        ).get('NDVI').getInfo()

                        trend_data.append({
                            'year': year,
                            'ndvi': round(mean_ndvi, 4) if mean_ndvi else None
                        })

            except Exception as e:
                print(f"Error processing year {year}: {e}")
                trend_data.append({
                    'year': year,
                    'ndvi': None
                })

        return jsonify({
            'success': True,
            'trend_data': trend_data,
            'county_name': county.get('COUNTY_NAM').getInfo()
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Get available counties
@app.route('/api/counties', methods=['GET'])
def get_counties():
    try:
        counties = load_counties()
        if not counties:
            return jsonify({'error': 'Failed to load counties data'}), 500

        # Get county list with geometry
        county_list = counties.getInfo()

        counties_data = []
        for feature in county_list['features']:
            counties_data.append({
                'code': feature['properties']['COUNTY_COD'],
                'name': feature['properties']['COUNTY_NAM'],
                'geometry': feature['geometry'],
                'CONSTITUEN': feature['properties'].get('CONSTITUEN', ''),
                'CONST_CODE': feature['properties'].get('CONST_CODE', ''),
                'COUNTY_COD': feature['properties'].get('COUNTY_COD', ''),
                'COUNTY_NAM': feature['properties'].get('COUNTY_NAM', ''),
                'ID_': feature['properties'].get('ID_', ''),
                'OBJECTID': feature['properties'].get('OBJECTID', ''),
                'Shape_Area': feature['properties'].get('Shape_Area', ''),
                'Shape_Leng': feature['properties'].get('Shape_Leng', ''),
                'system:index': feature['properties'].get('system:index', '')
            })

        return jsonify({
            'success': True,
            'counties': counties_data
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/')
def serve_frontend():
    return send_from_directory('.', 'zora.html')

@app.route('/zora2')
def serve_zora2():
    return send_from_directory('.', 'zora2.html')

@app.route('/index2')
def serve_index2():
    return send_from_directory('.', 'index2.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    if initialize_earth_engine():
        app.run(debug=True, port=5000, host='0.0.0.0')
    else:
        print("Failed to initialize Earth Engine. Exiting...")
