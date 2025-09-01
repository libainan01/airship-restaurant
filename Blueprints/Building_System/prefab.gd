class_name Prefab extends Node2D

#region Building_Data属性
var building_data:Building_Data
var size:Vector2 #按照格子数量定义大小
#endregion

func _init(building:Building_Data,cell_size) -> void:
	building_data = building
	
